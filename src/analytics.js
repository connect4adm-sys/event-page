/**
 * MMC Career Readiness Grant™ 2027–28 — Analytics & Aggregation Engine
 * Computes strictly measured metrics from real database records.
 * Adheres strictly to truthful labeling: 'Submitted city/district',
 * 'Submitted school name', and explicitly marks unmeasured dimensions as unconfigured.
 */

const { db } = require('./db');
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

function getDashboardSummary(dateRangeDays = 30) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const rangeStart = new Date(Date.now() - dateRangeDays * 24 * 60 * 60 * 1000).toISOString();

  // 1. Total Leads
  const totalRow = db.prepare('SELECT COUNT(*) as count FROM leads').get();
  const totalLeads = totalRow ? totalRow.count : 0;

  // 2. Leads Today
  const todayRow = db.prepare('SELECT COUNT(*) as count FROM leads WHERE created_at >= ?').get(todayStart);
  const leadsToday = todayRow ? todayRow.count : 0;

  // 3. Leads in Selected Range
  const rangeRow = db.prepare('SELECT COUNT(*) as count FROM leads WHERE created_at >= ?').get(rangeStart);
  const leadsInRange = rangeRow ? rangeRow.count : 0;

  // 4. Duplicate Suspects
  const dupRow = db.prepare('SELECT COUNT(*) as count FROM leads WHERE is_duplicate_suspect = 1').get();
  const duplicateSuspects = dupRow ? dupRow.count : 0;

  // 5. Sync Status Totals
  const gsheetStats = db.prepare(`
    SELECT google_sheet_sync_status as status, COUNT(*) as count 
    FROM leads GROUP BY google_sheet_sync_status
  `).all();

  const crmStats = db.prepare(`
    SELECT crm_sync_status as status, COUNT(*) as count 
    FROM leads GROUP BY crm_sync_status
  `).all();

  // 6. Role Breakdown
  const roleRows = db.prepare(`
    SELECT school_role, COUNT(*) as count 
    FROM leads 
    GROUP BY school_role 
    ORDER BY count DESC
  `).all();

  // 7. Lead Status Breakdown
  const statusRows = db.prepare(`
    SELECT lead_status, COUNT(*) as count 
    FROM leads 
    GROUP BY lead_status 
    ORDER BY count DESC
  `).all();

  // 8. Source Attribution Breakdown (computed over all leads)
  const allLeadsAttribution = db.prepare(`
    SELECT lead_id, utm_source, utm_medium, utm_campaign, referrer_url, fbclid 
    FROM leads
  `).all();

  const sourceCounts = {};
  allLeadsAttribution.forEach(lead => {
    const channel = classifyLeadSource(lead);
    sourceCounts[channel] = (sourceCounts[channel] || 0) + 1;
  });

  const sourceBreakdown = Object.entries(sourceCounts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  // 9. Campaign Breakdown
  const campaignRows = db.prepare(`
    SELECT COALESCE(utm_campaign, 'No Campaign Specified') as campaign, COUNT(*) as count 
    FROM leads 
    GROUP BY campaign 
    ORDER BY count DESC 
    LIMIT 10
  `).all();

  // 10. Daily Submission Trend (last 14 days)
  const trendRows = db.prepare(`
    SELECT SUBSTR(created_at, 1, 10) as day, COUNT(*) as count 
    FROM leads 
    WHERE created_at >= ? 
    GROUP BY day 
    ORDER BY day ASC
  `).all(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString());

  return {
    totalLeads,
    leadsToday,
    leadsInRange,
    duplicateSuspects,
    dateRangeDays,
    roleBreakdown: roleRows,
    statusBreakdown: statusRows,
    sourceBreakdown,
    campaignBreakdown: campaignRows,
    submissionTrend: trendRows,
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
function getGeographyReport() {
  const rows = db.prepare(`
    SELECT 
      school_city_district, 
      COUNT(*) as lead_count,
      MAX(created_at) as latest_submission
    FROM leads 
    GROUP BY school_city_district 
    ORDER BY lead_count DESC
  `).all();

  return {
    note: 'Locations represent the city or district submitted by school decision-makers in the enquiry form, not verified device geolocation.',
    records: rows
  };
}

/**
 * Grouped School Report (Strictly labeled as Submitted School Name)
 */
function getSchoolReport() {
  const rows = db.prepare(`
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

  return {
    note: 'School names are user-submitted in the lead enquiry form and have not yet undergone institutional accreditation verification.',
    records: rows
  };
}

/**
 * Meta Ads Specific Attribution Breakdown
 */
function getMetaAttributionDetails() {
  const metaLeads = db.prepare(`
    SELECT 
      lead_id, full_name, school_name, school_role, 
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, created_at
    FROM leads 
    WHERE fbclid IS NOT NULL OR utm_source LIKE '%meta%' OR utm_source LIKE '%facebook%' OR utm_source LIKE '%instagram%'
    ORDER BY created_at DESC
  `).all();

  // Campaign grouping
  const campaigns = {};
  metaLeads.forEach(l => {
    const c = l.utm_campaign || 'Unspecified Campaign';
    if (!campaigns[c]) campaigns[c] = { campaign: c, leads: 0, withFbclid: 0 };
    campaigns[c].leads += 1;
    if (l.fbclid) campaigns[c].withFbclid += 1;
  });

  return {
    isMetaApiConnected: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID),
    totalMetaAttributedLeads: metaLeads.length,
    leadsWithClickId: metaLeads.filter(l => l.fbclid).length,
    campaignBreakdown: Object.values(campaigns).sort((a, b) => b.leads - a.leads),
    metaLeads
  };
}

module.exports = {
  classifyLeadSource,
  getDashboardSummary,
  getGeographyReport,
  getSchoolReport,
  getMetaAttributionDetails
};
