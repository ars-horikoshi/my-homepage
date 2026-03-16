export async function onRequestGet({ env, request }) {
  if (!env.GCAL_CLIENT_SECRET) {
    return new Response(JSON.stringify({ error: "Google API設定がありません" }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const creds = JSON.parse(env.GCAL_CLIENT_SECRET);
  const { client_id } = creds.web ?? creds.installed;

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/gmail/callback`;

  const state = crypto.randomUUID();
  await env.SCHEDULE_KV.put("gmail_oauth_state", state, { expirationTtl: 600 });

  const params = new URLSearchParams({
    client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    302
  );
}
