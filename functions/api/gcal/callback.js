function htmlError(msg) {
  return new Response(`<html><body><p>${msg}</p><a href="/">トップへ戻る</a></body></html>`, {
    status: 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) return htmlError("認証コードが見つかりません");

  const savedState = await env.SCHEDULE_KV.get("oauth_state");
  if (!savedState || state !== savedState) {
    return htmlError("不正なリクエストです (state mismatch)");
  }
  await env.SCHEDULE_KV.delete("oauth_state");

  const creds = JSON.parse(env.GCAL_CLIENT_SECRET);
  const { client_id, client_secret } = creds.web ?? creds.installed;
  const redirectUri = `${url.origin}/api/gcal/callback`;

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id,
        client_secret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return htmlError(`トークン取得に失敗しました: ${err}`);
    }

    const tokenData = await tokenRes.json();
    await env.SCHEDULE_KV.put(
      "gcal_token",
      JSON.stringify({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expiry_date: Date.now() + tokenData.expires_in * 1000,
      })
    );

    return Response.redirect(`${url.origin}/`, 302);
  } catch (e) {
    return htmlError(`認証に失敗しました: ${e.message}`);
  }
}
