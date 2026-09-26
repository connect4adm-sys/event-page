import { verifyAdminSession } from '../_shared.js';

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Allow /admin/login and static assets (css, js, images, icons) without auth
  if (
    url.pathname === '/admin/login' ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico')
  ) {
    if (url.pathname === '/admin/login') {
      const session = await verifyAdminSession(request, env);
      if (session) {
        return Response.redirect(new URL('/admin', request.url).toString(), 302);
      }
    }
    return next();
  }

  // Check admin session
  const session = await verifyAdminSession(request, env);
  if (!session) {
    return Response.redirect(new URL('/admin/login', request.url).toString(), 302);
  }

  return next();
}
