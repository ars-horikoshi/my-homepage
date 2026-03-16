const SCOPES = 'openid email';

export async function onRequestGet(context) {
  const { env, request } = context;

  const clientSecret = JSON.parse(env.GCAL_CLIENT_SECRET);
  const clientId = clientSecret.web.client_id;

  const state = crypto.randomUUID();
  await env.SCHEDULE_KV.put(`auth_state:${state}`, '1', { expirationTtl: 600 });

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    302
  );
}
