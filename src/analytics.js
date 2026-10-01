/**
 * MMC Career Readiness Grant™ 2027–28 — Analytics & Aggregation Engine
 * Computes strictly measured metrics from real database records.
 * Adheres strictly to truthful labeling: 'Submitted city/district',
 * 'Submitted school name', and explicitly marks unmeasured dimensions as unconfigured.
 */

const { db, resolveDateBounds } = require('./db');
const sheets = require('./sheets');
const crm = require('./crm');

/**
 * Categorize lead source based on UTM and Referrer data.
 */
function classifyLeadSource(lead) {
  const utmSource = (lead.utm_source || '').toLowerCase();
  const utmMedium = (lead.utm_medium || '').toLowerCase();
  const referrer = (lead.referrer_url || '').toLowerCase();
  const hasFbclid = Boolean(lead.fbclid);

  if (hasFbclid || utmSource.includes('meta') || utmSource.includes('facebook') || utmSource.includes('instagram') || utmMedium.includes('cpc') || utmMedium.includes('paid')) {
    return 'Meta Ads / Paid Social';
  }
  if (utmSource.includes('google') || utmSource.includes('bing') || referrer.includes('google.') || referrer.includes('bing.')) {
    return 'Organic Search';
  }
  if (referrer && !referrer.includes('example.com') && !referrer.includes('localhost') && !referrer.includes('127.0.0.1')) {
    try {
      const parsed = new URL(referrer);
      return `Referral (${parsed.hostname.replace('www.', '')})`;
    } catch {
      return 'Referral (External)';
    }
  }
  if (!utmSource && !referrer) {
    return 'Direct / Navigated';
  }
  return utmSource ? `Campaign (${lead.utm_source})` : 'Unknown / Untracked';
}

function getDashboardSummary(options = {}) {
  const opts = typeof options === 'number' ? { days: options } : (options || {});
  const { since, until } = resolveDateBounds(opts);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  // 1. Total Leads (All Time)
  const totalRow = db.prepare('SELECT COUNT(*) as count FROM leads').get();
  const totalLeads = totalRow ? totalRow.count : 0;

  // 2. Leads Today
  const todayRow = db.prepare('SELECT COUNT(*) as count FROM leads WHERE created_at >= ?').get(todayStart);
  const leadsToday = todayRow ? todayRow.count : 0;

  // 3. Leads in Selected Range
  const rangeRow = db.prepare('SELECT COUNT(*) as count FROM leads WHERE created_at >= ? AND created_at <= ?').get(since, until);
  const leadsInRange = rangeRow ? rangeRow.count : 0;

  // 4. Duplicate Suspects
  const dupRow = db.prepare('SELECT COUNT(*) as count FROM leads WHERE is_duplicate_suspect = 1').get();
  const duplicateSuspects = dupRow ? dupRow.count : 0;

  // 5. Sync Status Totals
  const gsheetStats = db.prepare(`
    SELECT google_sheet_sync_status as status, COUNT(*) as count 
    FROM leads 
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY google_sheet_sync_status
  `).all(since, until);

  const crmStats = db.prepare(`
    SELECT crm_sync_status as status, COUNT(*) as count 
    FROM leads 
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY crm_sync_status
  `).all(since, until);

  // 6. Role Breakdown (within selected range)
  const roleRows = db.prepare(`
    SELECT school_role, COUNT(*) as count 
    FROM leads 
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY school_role 
    ORDER BY count DESC
  `).all(since, until);

  // 7. Lead Status Breakdown (within selected range)
  const statusRows = db.prepare(`
    SELECT lead_status, COUNT(*) as count 
    FROM leads 
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY lead_status 
    ORDER BY count DESC
  `).all(since, until);

  // 8. Source Attribution Breakdown (within selected range)
  const allLeadsAttribution = db.prepare(`
    SELECT lead_id, utm_source, utm_medium, utm_campaign, referrer_url, fbclid 
    FROM leads
    WHERE created_at >= ? AND created_at <= ?
  `).all(since, until);

  const sourceCounts = {};
  allLeadsAttribution.forEach(lead => {
    const channel = classifyLeadSource(lead);
    sourceCounts[channel] = (sourceCounts[channel] || 0) + 1;
  });

  const sourceBreakdown = Object.entries(sourceCounts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  // 9. Campaign Breakdown (within selected range)
  const campaignRows = db.prepare(`
    SELECT COALESCE(utm_campaign, 'Direct / Organic') as campaign, COUNT(*) as count 
    FROM leads 
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY campaign 
    ORDER BY count DESC 
    LIMIT 10
  `).all(since, until);

  // 10. Daily Submission Trend (within selected range)
  const trendRows = db.prepare(`
    SELECT SUBSTR(created_at, 1, 10) as day, COUNT(*) as count 
    FROM leads 
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY day 
    ORDER BY day ASC
  `).all(since, until);

  // 11. Visitor Traffic Intelligence for Same Time Range
  let visitorStats = { count: 0, unique_visitors: 0, avg_duration: 0, avg_scroll: 0, conversions: 0 };
  let visitorSources = [];
  let topVisitorCities = [];
  let sectionAggregates = {};

  try {
    const vRow = db.prepare(`
      SELECT 
        COUNT(*) as count,
        COUNT(DISTINCT visitor_id) as unique_visitors,
        AVG(total_duration_sec) as avg_duration,
        AVG(max_scroll_depth_pct) as avg_scroll,
        SUM(CASE WHEN is_converted = 1 OR lead_id IS NOT NULL THEN 1 ELSE 0 END) as conversions
      FROM visitor_sessions
      WHERE created_at >= ? AND created_at <= ?
    `).get(since, until);

    if (vRow) {
      visitorStats = {
        count: vRow.count || 0,
        unique_visitors: vRow.unique_visitors || 0,
        avg_duration: Math.round(vRow.avg_duration || 0),
        avg_scroll: Math.round(vRow.avg_scroll || 0),
        conversions: vRow.conversions || 0
      };
    }

    // Top traffic origin apps
    visitorSources = db.prepare(`
      SELECT source_app, COUNT(*) as count, AVG(total_duration_sec) as avg_duration
      FROM visitor_sessions
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY source_app
      ORDER BY count DESC
      LIMIT 8
    `).all(since, until);

    // Top cities
    topVisitorCities = db.prepare(`
      SELECT city, region, COUNT(*) as count
      FROM visitor_sessions
      WHERE created_at >= ? AND created_at <= ? AND city IS NOT NULL AND city != '' AND city != 'Unknown City'
      GROUP BY city
      ORDER BY count DESC
      LIMIT 10
    `).all(since, until);

    // Section heatmap
    const sessionRows = db.prepare(`
      SELECT sections_viewed FROM visitor_sessions
      WHERE created_at >= ? AND created_at <= ? AND sections_viewed IS NOT NULL
    `).all(since, until);

    sessionRows.forEach(row => {
      try {
        const arr = JSON.parse(row.sections_viewed || '[]');
        if (Array.isArray(arr)) {
          arr.forEach(sec => {
            const sid = sec.section_id || 'unknown';
            if (!sectionAggregates[sid]) {
              sectionAggregates[sid] = {
                section_id: sid,
                name: sec.name || sid,
                total_dwell_sec: 0,
                views_count: 0
              };
            }
            sectionAggregates[sid].total_dwell_sec += (sec.duration_sec || 0);
            sectionAggregates[sid].views_count += 1;
          });
        }
      } catch {}
    });
  } catch (err) {
    console.error('[getDashboardSummary visitor query]:', err);
  }

  const sectionsHeatmap = Object.values(sectionAggregates)
    .sort((a, b) => b.total_dwell_sec - a.total_dwell_sec);

  // Conversion rate: leads received / unique visitors
  const uniqueVis = visitorStats.unique_visitors;
  const convRate = uniqueVis > 0 
    ? Number(((leadsInRange / uniqueVis) * 100).toFixed(1)) 
    : (leadsInRange > 0 ? 100 : 0);

  return {
    totalLeads,
    leadsToday,
    leadsInRange,
    duplicateSuspects,
    period: opts.period || (opts.days ? `${opts.days}d` : '30d'),
    since,
    until,
    dateRangeDays: opts.days || 30,
    roleBreakdown: roleRows,
    statusBreakdown: statusRows,
    sourceBreakdown,
    campaignBreakdown: campaignRows,
    submissionTrend: trendRows,
    visitors: {
      totalVisitors: visitorStats.unique_visitors,
      totalVisits: visitorStats.count,
      avgDurationSec: visitorStats.avg_duration,
      avgScrollPct: visitorStats.avg_scroll,
      conversions: leadsInRange,
      conversionRate: convRate
    },
    topCities: topVisitorCities,
    sectionsHeatmap,
    visitorSources,
    gsheetStats,
    crmStats,
    integrations: {
      google_sheets: sheets.isConfigured(),
      crm: crm.isConfigured(),
      meta_api: {
        configured: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID),
        ad_account_id: process.env.META_AD_ACCOUNT_ID ? 'act_***' : null
      }
    }
  };
}

/**
 * Grouped Geography Report (Strictly labeled as Submitted City/District)
 */
function getGeographyReport(options = {}) {
  let rows;
  if (options.period || options.startDate || options.endDate) {
    const { since, until } = resolveDateBounds(options);
    rows = db.prepare(`
      SELECT 
        school_city_district, 
        COUNT(*) as lead_count,
        MAX(created_at) as latest_submission
      FROM leads 
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY school_city_district 
      ORDER BY lead_count DESC
    `).all(since, until);
  } else {
    rows = db.prepare(`
      SELECT 
        school_city_district, 
        COUNT(*) as lead_count,
        MAX(created_at) as latest_submission
      FROM leads 
      GROUP BY school_city_district 
      ORDER BY lead_count DESC
    `).all();
  }

  return {
    note: 'Locations represent the city or district submitted by school decision-makers in the enquiry form, not verified device geolocation.',
    records: rows
  };
}

/**
 * Grouped School Report (Strictly labeled as Submitted School Name)
 */
function getSchoolReport(options = {}) {
  let rows;
  if (options.period || options.startDate || options.endDate) {
    const { since, until } = resolveDateBounds(options);
    rows = db.prepare(`
      SELECT 
        school_name, 
        school_city_district, 
        COUNT(*) as applicant_count,
        MAX(created_at) as latest_submission,
        GROUP_CONCAT(DISTINCT school_role) as roles_represented
      FROM leads 
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY school_name_normalized 
      ORDER BY applicant_count DESC
    `).all(since, until);
  } else {
    rows = db.prepare(`
      SELECT 
        school_name, 
        school_city_district, 
        COUNT(*) as applicant_count,
        MAX(created_at) as latest_submission,
        GROUP_CONCAT(DISTINCT school_role) as roles_represented
      FROM leads 
      GROUP BY school_name_normalized 
      ORDER BY applicant_count DESC
    `).all();
  }

  return {
    note: 'School names are user-submitted in the lead enquiry form and have not yet undergone institutional accreditation verification.',
    records: rows
  };
}

/**
 * Meta Ads Specific Attribution & Dual-Campaign Reporting
 * Distinguishes cleanly between:
 * 1. Campaign 1: Meta Instant Form Leads (On-Platform Lead Gen)
 * 2. Campaign 2: Meta Website Visits (event.mymentorcircle.com Traffic)
 */
function getMetaAttributionDetails(options = {}) {
  const { since, until } = resolveDateBounds(options);
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const allowedFormId = process.env.META_ALLOWED_FORM_IDS || '1105883022363408';

  // -------------------------------------------------------------
  // 1. CAMPAIGN 1: Meta Instant Form Leads (On-Platform Lead Gen)
  // -------------------------------------------------------------
  const instantLeads = db.prepare(`
    SELECT 
      lead_id, full_name, phone, email, school_role, school_name, school_city_district,
      utm_source, utm_medium, utm_campaign, utm_content, fbclid,
      google_sheet_sync_status, crm_sync_status, crm_record_id, created_at
    FROM leads
    WHERE created_at >= ? AND created_at <= ?
      AND (
        utm_medium = 'paid_instant_form' 
        OR landing_page_url LIKE '%facebook.com/leadgen%'
        OR ip_address = 'Meta Webhook Server'
        OR utm_campaign LIKE '%1105883022363408%'
      )
    ORDER BY created_at DESC
  `).all(since, until);

  const instantLeadsToday = db.prepare(`
    SELECT COUNT(*) as count FROM leads
    WHERE created_at >= ?
      AND (
        utm_medium = 'paid_instant_form' 
        OR landing_page_url LIKE '%facebook.com/leadgen%'
        OR ip_address = 'Meta Webhook Server'
        OR utm_campaign LIKE '%1105883022363408%'
      )
  `).get(todayStart)?.count || 0;

  const instantRoleCounts = {};
  const instantCityCounts = {};
  let instantSheetsSynced = 0;
  let instantCrmSynced = 0;

  instantLeads.forEach(l => {
    const role = l.school_role || 'Other';
    instantRoleCounts[role] = (instantRoleCounts[role] || 0) + 1;

    const city = l.school_city_district || 'Online';
    instantCityCounts[city] = (instantCityCounts[city] || 0) + 1;

    if (l.google_sheet_sync_status === 'SYNCED') instantSheetsSynced++;
    if (l.crm_sync_status === 'SYNCED') instantCrmSynced++;
  });

  // -------------------------------------------------------------
  // 2. CAMPAIGN 2: Meta Website Visits (event.mymentorcircle.com)
  // -------------------------------------------------------------
  const metaSessions = db.prepare(`
    SELECT 
      session_id, visitor_id, ip_address, city, region, country,
      source_app, channel, source_badge, referrer, landing_url,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid,
      device_type, browser, os, total_duration_sec, max_scroll_depth_pct,
      sections_viewed, is_converted, lead_id, created_at, last_active_at
    FROM visitor_sessions
    WHERE created_at >= ? AND created_at <= ?
      AND (
        channel = 'Meta Ads' 
        OR fbclid IS NOT NULL 
        OR LOWER(utm_source) IN ('meta', 'facebook', 'instagram', 'fb', 'ig')
        OR LOWER(source_app) LIKE '%facebook%'
        OR LOWER(source_app) LIKE '%instagram%'
        OR LOWER(source_app) LIKE '%meta%'
        OR LOWER(referrer) LIKE '%facebook.com%'
        OR LOWER(referrer) LIKE '%instagram.com%'
      )
    ORDER BY created_at DESC
  `).all(since, until);

  const metaSessionsToday = db.prepare(`
    SELECT COUNT(*) as count FROM visitor_sessions
    WHERE created_at >= ?
      AND (
        channel = 'Meta Ads' 
        OR fbclid IS NOT NULL 
        OR LOWER(utm_source) IN ('meta', 'facebook', 'instagram', 'fb', 'ig')
        OR LOWER(source_app) LIKE '%facebook%'
        OR LOWER(source_app) LIKE '%instagram%'
        OR LOWER(source_app) LIKE '%meta%'
        OR LOWER(referrer) LIKE '%facebook.com%'
        OR LOWER(referrer) LIKE '%instagram.com%'
      )
  `).get(todayStart)?.count || 0;

  const totalClicks = metaSessions.length;
  const uniqueMetaVisitors = new Set(metaSessions.map(s => s.visitor_id)).size;
  const totalMetaDuration = metaSessions.reduce((sum, s) => sum + (s.total_duration_sec || 0), 0);
  const avgMetaDuration = totalClicks > 0 ? Math.round(totalMetaDuration / totalClicks) : 0;
  const totalMetaScroll = metaSessions.reduce((sum, s) => sum + (s.max_scroll_depth_pct || 0), 0);
  const avgMetaScroll = totalClicks > 0 ? Math.round(totalMetaScroll / totalClicks) : 0;

  // On-Site Conversions: visitors from Meta who filled the grant form on event.mymentorcircle.com
  const convertedSessions = metaSessions.filter(s => s.is_converted === 1 || s.lead_id);
  const onSiteConversions = convertedSessions.length;
  const onSiteConversionRate = totalClicks > 0 ? ((onSiteConversions / totalClicks) * 100).toFixed(1) : '0.0';

  const deviceCounts = {};
  const appCounts = {};
  const cityCounts = {};
  const sectionAggregates = {};

  metaSessions.forEach(s => {
    // Device
    const dev = s.device_type || 'Mobile';
    deviceCounts[dev] = (deviceCounts[dev] || 0) + 1;

    // App / Browser
    const app = s.source_app || 'Meta Platform';
    appCounts[app] = (appCounts[app] || 0) + 1;

    // Location
    const c = s.city && s.city !== 'Unknown City' ? `${s.city}, ${s.region || 'IN'}`.trim() : 'Other / In-Transit';
    cityCounts[c] = (cityCounts[c] || 0) + 1;

    // Sections explored on event.mymentorcircle.com
    try {
      const arr = JSON.parse(s.sections_viewed || '[]');
      if (Array.isArray(arr)) {
        arr.forEach(sec => {
          const sid = sec.section_id || 'unknown';
          if (!sectionAggregates[sid]) {
            sectionAggregates[sid] = {
              section_id: sid,
              name: sec.name || sid,
              total_dwell_sec: 0,
              views_count: 0
            };
          }
          sectionAggregates[sid].total_dwell_sec += (sec.duration_sec || 0);
          sectionAggregates[sid].views_count += 1;
        });
      }
    } catch {}
  });

  const sectionsHeatmap = Object.values(sectionAggregates)
    .sort((a, b) => b.total_dwell_sec - a.total_dwell_sec);

  // -------------------------------------------------------------
  // 3. Combined & Backward-Compatible Aggregations
  // -------------------------------------------------------------
  const allMetaLeads = db.prepare(`
    SELECT 
      lead_id, full_name, school_name, school_role, 
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, created_at
    FROM leads 
    WHERE created_at >= ? AND created_at <= ?
      AND (fbclid IS NOT NULL OR utm_source LIKE '%meta%' OR utm_source LIKE '%facebook%' OR utm_source LIKE '%instagram%' OR utm_medium = 'paid_instant_form')
    ORDER BY created_at DESC
  `).all(since, until);

  const campaigns = {};
  allMetaLeads.forEach(l => {
    const c = l.utm_campaign || 'Unspecified Campaign';
    if (!campaigns[c]) campaigns[c] = { campaign: c, leads: 0, withFbclid: 0 };
    campaigns[c].leads += 1;
    if (l.fbclid) campaigns[c].withFbclid += 1;
  });

  return {
    period: options.period || '30d',
    since,
    until,
    isMetaApiConnected: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID),

    // Campaign 1: Meta Instant Form Leads (On-Platform)
    instantFormsCampaign: {
      campaignName: 'Meta Instant Form Leads (On-Platform)',
      campaignType: 'On-Platform Lead Generation',
      whitelistedFormId: allowedFormId,
      totalLeads: instantLeads.length,
      todayLeads: instantLeadsToday,
      sheetsSynced: instantSheetsSynced,
      crmSynced: instantCrmSynced,
      roles: Object.entries(instantRoleCounts).map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count),
      cities: Object.entries(instantCityCounts).map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count),
      leads: instantLeads.slice(0, 50)
    },

    // Campaign 2: Meta Website Visits (Landing Page Traffic)
    websiteTrafficCampaign: {
      campaignName: 'Meta Website Visits (event.mymentorcircle.com)',
      campaignType: 'Website Traffic / Conversions',
      destinationDomain: 'event.mymentorcircle.com',
      destinationUrl: 'https://event.mymentorcircle.com/',
      totalClicks,
      todayClicks: metaSessionsToday,
      uniqueVisitors: uniqueMetaVisitors,
      avgDurationSec: avgMetaDuration,
      avgScrollPct: avgMetaScroll,
      onSiteConversions,
      conversionRate: Number(onSiteConversionRate),
      devices: Object.entries(deviceCounts).map(([device, count]) => ({ device, count })).sort((a, b) => b.count - a.count),
      apps: Object.entries(appCounts).map(([app, count]) => ({ app, count })).sort((a, b) => b.count - a.count),
      topCities: Object.entries(cityCounts).map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      sectionsHeatmap,
      recentSessions: metaSessions.slice(0, 50)
    },

    // Cross-Campaign Comparison
    comparison: {
      totalMetaLeadsCombined: instantLeads.length + onSiteConversions,
      instantFormLeads: instantLeads.length,
      websiteLeads: onSiteConversions,
      websiteVisitors: uniqueMetaVisitors,
      websiteBounceRatio: totalClicks > 0 ? (((totalClicks - onSiteConversions) / totalClicks) * 100).toFixed(1) + '%' : '0%'
    },

    // Backward compatibility
    totalMetaAttributedLeads: allMetaLeads.length,
    leadsWithClickId: allMetaLeads.filter(l => l.fbclid).length,
    campaignBreakdown: Object.values(campaigns).sort((a, b) => b.leads - a.leads),
    metaLeads: allMetaLeads
  };
}

module.exports = {
  classifyLeadSource,
  getDashboardSummary,
  getGeographyReport,
  getSchoolReport,
  getMetaAttributionDetails
};
