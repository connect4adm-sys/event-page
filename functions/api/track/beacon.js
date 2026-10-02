/**
 * Cloudflare Pages Function: /api/track/beacon
 * Heartbeat & pagehide dwell time beacon update on Cloudflare Edge
 */

import { json } from '../../_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const sessionId = payload.session_id;
  if (!sessionId) {
    return json({ success: false, message: 'session_id required' }, 400);
  }

  const durationSec = Math.max(0, parseInt(payload.total_duration_sec || payload.dwell_time_seconds, 10) || 0);
  const scrollPct = Math.min(100, Math.max(0, parseInt(payload.max_scroll_depth_pct || payload.max_scroll_depth, 10) || 0));

  let sectionsJson = null;
  if (Array.isArray(payload.sections)) {
    sectionsJson = JSON.stringify(payload.sections);
  } else if (Array.isArray(payload.sections_visited)) {
    const arr = payload.sections_visited.map(sid => ({
      section_id: sid,
      duration_sec: payload.section_dwells?.[sid] || 0
    }));
    sectionsJson = JSON.stringify(arr);
  }

  if (env && env.DB) {
    try {
      if (sectionsJson) {
        await env.DB.prepare(`
          UPDATE visitor_sessions SET
            total_duration_sec = MAX(total_duration_sec, ?),
            max_scroll_depth_pct = MAX(max_scroll_depth_pct, ?),
            sections_viewed = ?,
            last_active_at = ?
          WHERE session_id = ?
        `).bind(durationSec, scrollPct, sectionsJson, new Date().toISOString(), sessionId).run();
      } else {
        await env.DB.prepare(`
          UPDATE visitor_sessions SET
            total_duration_sec = MAX(total_duration_sec, ?),
            max_scroll_depth_pct = MAX(max_scroll_depth_pct, ?),
            last_active_at = ?
          WHERE session_id = ?
        `).bind(durationSec, scrollPct, new Date().toISOString(), sessionId).run();
      }
    } catch (err) {
      console.error('[Cloudflare Track Beacon Error]:', err);
    }
  }

  return json({ success: true }, 200);
}
