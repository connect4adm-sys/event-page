/**
 * Cloudflare Pages Function: /api/admin/tracking/summary
 * Aggregates first-party visitor telemetry, section attention heatmap, and geography
 */

import { json, verifyAdminSession } from '../../../_shared.js';

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

function resolveDateBounds({ period = '30d', startDate = null, endDate = null } = {}) {
  const now = new Date();
  let since = null;
  let until = now.toISOString();

  if (startDate || endDate) {
    if (startDate) since = startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`;
    if (endDate) until = endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`;
    if (!since) since = new Date(Date.now() - 30 * 86400000).toISOString();
    return { since, until };
  }

  const p = (period || '').toLowerCase();
  if (p === 'today') {
    since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  } else if (p === 'yesterday') {
    const todayMidnight = new Date(new Date().setHours(0, 0, 0, 0));
    since = new Date(todayMidnight.getTime() - 86400000).toISOString();
    until = new Date(todayMidnight.getTime() - 1).toISOString();
  } else if (p === '7d' || p === '7days') {
    since = new Date(Date.now() - 7 * 86400000).toISOString();
  } else if (p === '30d' || p === '30days') {
    since = new Date(Date.now() - 30 * 86400000).toISOString();
  } else if (p === '6m' || p === '6months') {
    since = new Date(Date.now() - 180 * 86400000).toISOString();
  } else {
    since = new Date(Date.now() - 30 * 86400000).toISOString();
  }

  return { since, until };
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || 'today';
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  const { since, until } = resolveDateBounds({ period, startDate, endDate });

  if (!env || !env.DB) {
    return json({
      success: true,
      summary: {
        totalVisitors: 0,
        totalSessions: 0,
        avgDurationSec: 0,
        avgScrollPct: 0,
        totalConversions: 0,
        conversionRate: '0.0',
        sectionHeatmap: [],
        topCities: [],
        sources: []
      }
    }, 200);
  }

  try {
    // 1. Overall Metrics
    const kpiRow = await env.DB.prepare(`
      SELECT 
        COUNT(DISTINCT visitor_id) as total_visitors,
        COUNT(*) as total_sessions,
        COALESCE(AVG(total_duration_sec), 0) as avg_duration,
        COALESCE(AVG(max_scroll_depth_pct), 0) as avg_scroll,
        COALESCE(SUM(CASE WHEN is_converted = 1 THEN 1 ELSE 0 END), 0) as total_conversions
      FROM visitor_sessions
      WHERE created_at >= ? AND created_at <= ?
    `).bind(since, until).first() || {};

    const totalVisitors = kpiRow.total_visitors || 0;
    const totalSessions = kpiRow.total_sessions || 0;
    const avgDuration = Math.round(kpiRow.avg_duration || 0);
    const avgScroll = Math.round(kpiRow.avg_scroll || 0);
    const totalConversions = kpiRow.total_conversions || 0;
    const conversionRate = totalSessions > 0 ? ((totalConversions / totalSessions) * 100).toFixed(1) : '0.0';

    // 2. Section Dwell-Time Aggregation
    const sectionsRows = await env.DB.prepare(`
      SELECT sections_viewed FROM visitor_sessions
      WHERE created_at >= ? AND created_at <= ? AND sections_viewed IS NOT NULL AND sections_viewed != ''
    `).bind(since, until).all();

    const sectionAggregates = {};
    (sectionsRows.results || []).forEach(row => {
      try {
        const arr = JSON.parse(row.sections_viewed);
        if (Array.isArray(arr)) {
          arr.forEach(item => {
            const sid = item.section_id || 'unknown';
            if (!sectionAggregates[sid]) {
              sectionAggregates[sid] = {
                section_id: sid,
                name: SECTION_NAMES[sid] || item.name || sid,
                total_dwell_sec: 0,
                session_views_count: 0
              };
            }
            sectionAggregates[sid].total_dwell_sec += (item.duration_sec || 0);
            sectionAggregates[sid].session_views_count += 1;
          });
        }
      } catch {}
    });

    const totalDwellAll = Object.values(sectionAggregates).reduce((sum, s) => sum + s.total_dwell_sec, 0);
    const sectionHeatmap = Object.values(sectionAggregates).map(s => ({
      ...s,
      percentage: totalDwellAll > 0 ? Math.round((s.total_dwell_sec / totalDwellAll) * 100) : 0
    })).sort((a, b) => b.total_dwell_sec - a.total_dwell_sec);

    // 3. Top Cities Breakdown
    const cityRes = await env.DB.prepare(`
      SELECT 
        city, region, country,
        COUNT(*) as visitor_count,
        SUM(CASE WHEN is_converted = 1 THEN 1 ELSE 0 END) as conversions,
        AVG(total_duration_sec) as avg_duration
      FROM visitor_sessions
      WHERE created_at >= ? AND created_at <= ? AND city IS NOT NULL AND city != '' AND city != 'Unknown City'
      GROUP BY city, region
      ORDER BY visitor_count DESC
      LIMIT 10
    `).bind(since, until).all();

    // 4. Source App Breakdown
    const sourceRes = await env.DB.prepare(`
      SELECT 
        source_app, channel, source_badge,
        COUNT(*) as session_count,
        COUNT(DISTINCT visitor_id) as unique_visitors,
        SUM(CASE WHEN is_converted = 1 THEN 1 ELSE 0 END) as conversions,
        AVG(total_duration_sec) as avg_duration
      FROM visitor_sessions
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY source_app
      ORDER BY session_count DESC
      LIMIT 8
    `).bind(since, until).all();

    return json({
      success: true,
      summary: {
        period,
        sinceDate: since,
        untilDate: until,
        totalVisitors,
        totalSessions,
        avgDurationSec: avgDuration,
        avgScrollPct: avgScroll,
        totalConversions,
        conversionRate,
        sectionHeatmap,
        topCities: cityRes.results || [],
        sources: sourceRes.results || []
      }
    }, 200);

  } catch (err) {
    console.error('[Cloudflare Tracking Summary Error]:', err);
    return json({ success: false, error: err.message }, 500);
  }
}
