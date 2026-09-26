import { verifyAdminSession } from '../_shared.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  const isLoginPage = url.pathname === '/admin/login' || url.pathname === '/admin/login.html';

  // Allow login page and static assets without auth
  if (
    isLoginPage ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico')
  ) {
    if (isLoginPage) {
      const cookies = request.headers.get('Cookie') || '';
      if (cookies.includes('mmc_admin_session=')) {
        const session = await verifyAdminSession(request, env);
        if (session) {
          return Response.redirect(new URL('/admin', request.url).toString(), 302);
        }
      }
    }
    return next();
  }

  // Fast cookie check before querying D1: if cookie absent, redirect instantly
  const cookieHeader = request.headers.get('Cookie') || '';
  if (!cookieHeader.includes('mmc_admin_session=')) {
    return Response.redirect(new URL('/admin/login', request.url).toString(), 302);
  }

  // Validate active admin session in D1
  const session = await verifyAdminSession(request, env);
  if (!session) {
    return Response.redirect(new URL('/admin/login', request.url).toString(), 302);
  }

  return next();
}
