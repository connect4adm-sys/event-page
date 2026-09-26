import { json, getClientIp, verifyPassword } from '../../_shared.js';
import crypto from 'node:crypto';

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ success: false, message: 'Cloudflare D1 database binding (DB) is missing.' }, 500);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: 'Invalid JSON request payload.' }, 400);
  }

  const password = typeof body.password === 'string' ? body.password : '';
  const clientIp = getClientIp(request);

  const isValid = verifyPassword(password, env);
  if (!isValid) {
    return json({
      success: false,
      message: 'Invalid administrative password. Access denied.'
    }, 401);
  }

  // Generate session token
  let token;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomBytes === 'function') {
      token = crypto.randomBytes(32).toString('hex');
    } else {
      const bytes = new Uint8Array(32);
      (globalThis.crypto || crypto).getRandomValues(bytes);
      token = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    const bytes = new Uint8Array(32);
    (globalThis.crypto || crypto).getRandomValues(bytes);
    token = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  try {
    // Clean expired sessions
    await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= datetime("now")').run();

    // Insert new session
    await env.DB.prepare(
      'INSERT INTO admin_sessions (token, expires_at, created_at, ip_address) VALUES (?, ?, datetime("now"), ?)'
    ).bind(token, expiresAt, clientIp).run();

    const cookieHeader = `mmc_admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`;

    return json({
      success: true,
      message: 'Authentication successful.',
      expiresAt
    }, 200, { 'Set-Cookie': cookieHeader });
  } catch (err) {
    console.error('Login session creation error:', err);
    return json({ success: false, message: 'Internal error generating administrative session.' }, 500);
  }
}
