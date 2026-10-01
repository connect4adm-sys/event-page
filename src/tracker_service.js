/**
 * MMC Career Readiness Grant™ 2027–28 — Visitor Intelligence & Tracking Service
 * Coordinates non-blocking session recording, geolocation resolution,
 * section dwell time aggregation, and executive conversion analytics.
 */

const db = require('./db');
const geo = require('./geo');
const attribution = require('./attribution');

// Standard friendly names for landing-page sections
const SECTION_NAMES = {
  'top': 'Hero (Grant Introduction)',
  'stats': 'National Scale Statistics',
  'how-to-qualify': 'Qualify Mechanism (4 Steps)',
  'grant': 'Grant Structure (₹25K to ₹2L)',
  'activities-framework': '10 Approved Point Activities',
  'programme': 'Implementation & Academic Scope',
  'video-sec': 'Leadership Video Spotlight',
  'how': 'Timeline & Onboarding Process',
  'requirements': 'Eligibility & Compliance',
  'gallery': 'Campus Evidence & Workshop Life',
  'why': 'Why MMC (Strategic Advantage)',
  'about': 'About MMC & Leadership',
  'schools': 'School Network Showcase',
  'experiences': 'Video Testimonials & Reviews',
  'catalogue': 'Topic Catalogue & PDF Download',
  'contact': 'Eligibility Application Form',
  'modal': 'Lead Application Modal'
};

/**
 * Handle initial session arrival or periodic heartbeat
 */
async function processSessionPing(payload, req) {
  const sessionId = payload.session_id || `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const visitorId = payload.visitor_id || `vid_${Math.random().toString(36).substring(2, 10)}`;
  const clientIp = geo.extractClientIp(req);
  const userAgent = req.headers['user-agent'] || payload.user_agent || '';

  // Resolve Location (City, Region, Country)
  const location = await geo.resolveLocation(req, {
    timezone: payload.timezone,
    city_hint: payload.city_hint
  });

  // Resolve Source & Device Attribution
  const traffic = attribution.detectTrafficSource(payload.query || {}, payload.referrer || '', userAgent);
  const device = attribution.parseUserAgent(userAgent);

  const sectionsJson = JSON.stringify(payload.sections || []);

  const sessionRecord = {
    session_id: sessionId,
    visitor_id: visitorId,
    ip_address: clientIp,
    city: location.city || 'Unknown City',
    region: location.region || '',
    country: location.country || 'India',
    isp: location.isp || '',
    source_app: traffic.sourceApp,
    channel: traffic.channel,
    source_badge: traffic.badge,
    referrer: payload.referrer || null,
    landing_url: payload.landing_url || null,
    utm_source: payload.query?.utm_source || null,
    utm_medium: payload.query?.utm_medium || null,
    utm_campaign: payload.query?.utm_campaign || null,
    utm_content: payload.query?.utm_content || null,
    utm_term: payload.query?.utm_term || null,
    fbclid: payload.query?.fbclid || null,
    device_type: payload.device_type || device.deviceType,
    browser: device.browser,
    os: device.os,
    screen_resolution: payload.screen || null,
    total_duration_sec: Math.max(0, parseInt(payload.total_duration_sec, 10) || 0),
    max_scroll_depth_pct: Math.min(100, Math.max(0, parseInt(payload.max_scroll_depth_pct, 10) || 0)),
    sections_viewed: sectionsJson,
    lead_id: payload.lead_id || null,
    is_converted: payload.lead_id ? 1 : 0,
    created_at: payload.created_at || new Date().toISOString(),
    last_active_at: new Date().toISOString()
  };

  db.upsertVisitorSession(sessionRecord);

  // If specific event is attached
  if (payload.event_type) {
    db.recordVisitorEvent({
      session_id: sessionId,
      event_type: payload.event_type,
      section_id: payload.current_section || null,
      duration_sec: parseInt(payload.section_dwell_sec, 10) || 0,
      metadata: JSON.stringify(payload.event_metadata || {}),
      created_at: new Date().toISOString()
    });
  }

  return {
    success: true,
    session_id: sessionId,
    location: {
      city: sessionRecord.city,
      region: sessionRecord.region,
      country: sessionRecord.country
    },
    source: sessionRecord.source_app,
    source_app: sessionRecord.source_app,
    channel: sessionRecord.channel,
    source_badge: sessionRecord.source_badge,
    device: device
  };
}

/**
 * Handle unload beacon (sendBeacon / keepalive fetch)
 */
function processBeacon(payload, req) {
  if (!payload || !payload.session_id) return { success: false };

  const durationSec = Math.max(0, parseInt(payload.total_duration_sec || payload.dwell_time_seconds, 10) || 0);
  const scrollPct = Math.min(100, Math.max(0, parseInt(payload.max_scroll_depth_pct || payload.max_scroll_depth, 10) || 0));
  
  let sectionsJson = null;
  if (Array.isArray(payload.sections)) {
    sectionsJson = JSON.stringify(payload.sections);
  } else if (Array.isArray(payload.sections_visited)) {
    const arr = payload.sections_visited.map(sid => ({
      section_id: sid,
      name: SECTION_NAMES[sid] || sid,
      duration_sec: payload.section_dwells?.[sid] || 0
    }));
    sectionsJson = JSON.stringify(arr);
  }

  db.updateSessionDurationAndSections(
    payload.session_id,
    durationSec,
    scrollPct,
    sectionsJson,
    payload.lead_id || null
  );

  return { success: true };
}

/**
 * Compute aggregated analytics for admin dashboard
 */
function getTrackingSummary(options = 30) {
  return db.getVisitorTrackingSummary(options, SECTION_NAMES);
}

module.exports = {
  SECTION_NAMES,
  processSessionPing,
  processBeacon,
  getTrackingSummary
};
