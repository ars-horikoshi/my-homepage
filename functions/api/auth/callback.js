const ALLOWED_EMAIL = 't-horikoshi@ar-system.co.jp';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error || !code || !state) {
    return Response.redirect(new URL('/login?error=cancelled', request.url), 302);
  }

  // state 検証（CSRF 対策）
  const validState = await env.SCHEDULE_KV.get(`auth_state:${state}`);
  if (!validState) {
    return Response.redirect(new URL('/login?error=invalid_state', request.url), 302);
  }
  await env.SCHEDULE_KV.delete(`auth_state:${state}`);

  // 認可コードをトークンに交換
  const clientSecret = JSON.parse(env.GCAL_CLIENT_SECRET);
  const { client_id, client_secret } = clientSecret.web;
  const redirectUri = `${url.origin}/api/auth/callback`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id,
      client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    return Response.redirect(new URL('/login?error=token_failed', request.url), 302);
  }

  const tokens = await tokenRes.json();

  // メールアドレス取得
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    return Response.redirect(new URL('/login?error=userinfo_failed', request.url), 302);
  }

  const userInfo = await userRes.json();

  if (userInfo.email !== ALLOWED_EMAIL) {
    return Response.redirect(new URL('/login?error=unauthorized', request.url), 302);
  }

  // セッション発行（7日間）
  const sessionToken = crypto.randomUUID();
  await env.SCHEDULE_KV.put(`session:${sessionToken}`, '1', { expirationTtl: 604800 });

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/`,
    },
  });
}
