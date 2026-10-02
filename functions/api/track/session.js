/**
 * Cloudflare Pages Function: /api/track/session
 * Real-time visitor session capture on Cloudflare Edge with native geolocation
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

  const sessionId = payload.session_id || `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const visitorId = payload.visitor_id || `vid_${Math.random().toString(36).substring(2, 10)}`;
  const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
  const userAgent = request.headers.get('user-agent') || payload.user_agent || '';

  // Native Cloudflare Edge Geolocation
  const cf = request.cf || {};
  const city = cf.city || payload.city_hint || 'Unknown City';
  const region = cf.region || '';
  const country = cf.country || 'India';
  const isp = cf.asOrganization || '';

  // Attribution detection
  const q = payload.query || {};
  const ref = (payload.referrer || '').toLowerCase();
  const ua = userAgent.toLowerCase();

  let sourceApp = 'Direct';
  let channel = 'Direct';
  let sourceBadge = 'DIRECT';

  if (q.utm_source) {
    const s = q.utm_source.toLowerCase();
    if (s.includes('instagram')) { sourceApp = 'Instagram Ad'; channel = 'Meta Ads'; sourceBadge = 'INSTAGRAM'; }
    else if (s.includes('facebook') || s.includes('fb')) { sourceApp = 'Facebook Ad'; channel = 'Meta Ads'; sourceBadge = 'FACEBOOK'; }
    else if (s.includes('meta')) { sourceApp = 'Meta Ad'; channel = 'Meta Ads'; sourceBadge = 'META'; }
    else if (s.includes('google')) { sourceApp = 'Google Search'; channel = 'Google Ads'; sourceBadge = 'GOOGLE'; }
    else { sourceApp = q.utm_source; channel = 'Campaign'; sourceBadge = 'CAMPAIGN'; }
  } else if (q.fbclid) {
    sourceApp = ua.includes('instagram') ? 'Instagram In-App' : 'Facebook App';
    channel = 'Meta Organic/Ad';
    sourceBadge = 'META';
  } else if (ref.includes('instagram.com')) {
    sourceApp = 'Instagram Web/App';
    channel = 'Social Referral';
    sourceBadge = 'INSTAGRAM';
  } else if (ref.includes('facebook.com') || ref.includes('fb.com')) {
    sourceApp = 'Facebook Web';
    channel = 'Social Referral';
    sourceBadge = 'FACEBOOK';
  } else if (ref.includes('google.')) {
    sourceApp = 'Google Organic';
    channel = 'Search Engine';
    sourceBadge = 'SEARCH';
  }

  // Device detection
  let deviceType = payload.device_type || 'Mobile';
  if (!payload.device_type) {
    if (/tablet|ipad/i.test(ua)) deviceType = 'Tablet';
    else if (/mobile|iphone|android/i.test(ua)) deviceType = 'Mobile';
    else deviceType = 'Desktop';
  }

  let browser = 'Chrome';
  if (ua.includes('instagram')) browser = 'Instagram Webview';
  else if (ua.includes('fban') || ua.includes('fbav')) browser = 'Facebook In-App';
  else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
  else if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('edg')) browser = 'Edge';

  const sectionsJson = JSON.stringify(payload.sections || []);

  if (env && env.DB) {
    try {
      // Auto-ensure table exists
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS visitor_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT UNIQUE NOT NULL,
          visitor_id TEXT NOT NULL,
          ip_address TEXT,
          city TEXT,
          region TEXT,
          country TEXT,
          isp TEXT,
          source_app TEXT,
          channel TEXT,
          source_badge TEXT,
          referrer TEXT,
          landing_url TEXT,
          utm_source TEXT,
          utm_medium TEXT,
          utm_campaign TEXT,
          utm_content TEXT,
          utm_term TEXT,
          fbclid TEXT,
          device_type TEXT,
          browser TEXT,
          os TEXT,
          screen_resolution TEXT,
          total_duration_sec INTEGER DEFAULT 0,
          max_scroll_depth_pct INTEGER DEFAULT 0,
          sections_viewed TEXT,
          lead_id TEXT,
          is_converted INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          last_active_at TEXT NOT NULL
        )
      `).run();

      await env.DB.prepare(`
        INSERT INTO visitor_sessions (
          session_id, visitor_id, ip_address, city, region, country, isp,
          source_app, channel, source_badge, referrer, landing_url,
          utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid,
          device_type, browser, screen_resolution, total_duration_sec,
          max_scroll_depth_pct, sections_viewed, is_converted, created_at, last_active_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, 0, ?, ?
        )
        ON CONFLICT(session_id) DO UPDATE SET
          last_active_at = excluded.last_active_at,
          total_duration_sec = MAX(visitor_sessions.total_duration_sec, excluded.total_duration_sec)
      `).bind(
        sessionId, visitorId, clientIp, city, region, country, isp,
        sourceApp, channel, sourceBadge, payload.referrer || null, payload.landing_url || null,
        q.utm_source || null, q.utm_medium || null, q.utm_campaign || null, q.utm_content || null, q.utm_term || null, q.fbclid || null,
        deviceType, browser, payload.screen || null, Math.max(0, parseInt(payload.total_duration_sec, 10) || 0),
        Math.min(100, Math.max(0, parseInt(payload.max_scroll_depth_pct, 10) || 0)), sectionsJson,
        payload.created_at || new Date().toISOString(), new Date().toISOString()
      ).run();
    } catch (err) {
      console.error('[Cloudflare Track Session Error]:', err);
    }
  }

  return json({
    success: true,
    session_id: sessionId,
    location: { city, region, country },
    source: sourceApp,
    device: deviceType
  }, 200);
}
