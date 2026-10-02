/**
 * Cloudflare Pages Function: /api/admin/tracking/sessions
 * Real-time visitor session stream feed with pagination and filters
 */

import { json, verifyAdminSession, resolveDateBounds } from '../../../_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  const url = new URL(request.url);
  const p = url.searchParams;
  const limit = Math.min(100, Math.max(1, parseInt(p.get('limit'), 10) || 25));
  const offset = Math.max(0, parseInt(p.get('offset'), 10) || 0);
  const period = p.get('period') || '';
  const startDate = p.get('startDate') || '';
  const endDate = p.get('endDate') || '';
  const search = p.get('search') || '';

  if (!env || !env.DB) {
    return json({ success: true, total: 0, sessions: [] }, 200);
  }

  try {
    let whereClauses = [];
    let params = [];

    if (period || (startDate && endDate)) {
      const { since, until } = resolveDateBounds({ period, startDate, endDate });
      whereClauses.push('created_at >= ? AND created_at <= ?');
      params.push(since, until);
    }

    if (search) {
      whereClauses.push(`(
        session_id LIKE ? OR visitor_id LIKE ? OR city LIKE ? OR region LIKE ? OR 
        source_app LIKE ? OR utm_campaign LIKE ? OR browser LIKE ? OR lead_id LIKE ?
      )`);
      const q = `%${search}%`;
      params.push(q, q, q, q, q, q, q, q);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRow = await env.DB.prepare(`SELECT COUNT(*) as total FROM visitor_sessions ${whereSql}`).bind(...params).first();
    const total = countRow?.total || 0;

    const rows = await env.DB.prepare(`
      SELECT 
        session_id, visitor_id, ip_address, city, region, country, isp,
        source_app, channel, source_badge, referrer, landing_url,
        utm_source, utm_medium, utm_campaign, device_type, browser,
        total_duration_sec, max_scroll_depth_pct, sections_viewed,
        lead_id, is_converted, created_at, last_active_at
      FROM visitor_sessions
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    return json({
      success: true,
      total,
      limit,
      offset,
      sessions: rows.results || []
    }, 200);
  } catch (err) {
    console.error('[Cloudflare Tracking Sessions Error]:', err);
    return json({ success: false, error: err.message }, 500);
  }
}
