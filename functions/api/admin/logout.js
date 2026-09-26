import { json, parseCookies } from '../../_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const token = cookies.mmc_admin_session;

  if (token && env.DB) {
    try {
      await env.DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
    } catch (err) {
      console.error('Logout error:', err);
    }
  }

  const clearCookie = `mmc_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

  return json({
    success: true,
    message: 'Logged out successfully.'
  }, 200, { 'Set-Cookie': clearCookie });
}
