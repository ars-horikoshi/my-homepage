export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // ログインページと認証 API は認証不要
  if (
    path === '/login' ||
    path === '/login.html' ||
    path === '/api/auth/login' ||
    path === '/api/auth/callback'
  ) {
    return next();
  }

  // セッション Cookie を確認
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  const token = match ? match[1] : null;

  if (token) {
    const valid = await env.SCHEDULE_KV.get(`session:${token}`);
    if (valid) return next();
  }

  // 未認証
  if (path.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return Response.redirect(new URL('/login', request.url), 302);
}
