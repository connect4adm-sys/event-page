/**
 * MMC Career Readiness Grant™ 2027–28 — Meta Marketing API Integration Module
 * Queries Meta Graph API to fetch live campaign lists, campaign insights,
 * adset-level breakdowns, and ad-level performance metrics.
 */

const https = require('node:https');
require('./env');
const db = require('./db');

const getAccessToken = () => process.env.META_PAGE_ACCESS_TOKEN || '';
const getAdAccountId = () => (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          reject(new Error(`Failed to parse Meta API response: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * 1. List all campaigns in the Meta Ad Account
 */
async function listCampaigns() {
  const token = getAccessToken();
  const adAccountId = getAdAccountId();

  if (!token || !adAccountId) {
    return {
      success: false,
      error: 'META_PAGE_ACCESS_TOKEN or META_AD_ACCOUNT_ID is not configured in .env',
      campaigns: []
    };
  }

  try {
    const url = `https://graph.facebook.com/v19.0/act_${encodeURIComponent(adAccountId)}/campaigns?fields=id,name,status,objective,start_time&limit=50&access_token=${encodeURIComponent(token)}`;
    const result = await httpsGetJson(url);

    if (result.error) {
      console.warn('[Meta API Error in listCampaigns]:', result.error.message);
      return { success: false, error: result.error.message, campaigns: [] };
    }

    const campaigns = (result.data || []).map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective,
      start_time: c.start_time
    }));

    return { success: true, campaigns };
  } catch (err) {
    console.error('[Meta Marketing API Error]:', err.message);
    return { success: false, error: err.message, campaigns: [] };
  }
}

function parseMetricsFromActions(actions = [], costPerActions = [], spend = 0, clicks = 0) {
  const getVal = (types) => {
    for (const t of types) {
      const match = actions.find(a => a.action_type === t);
      if (match) return parseInt(match.value, 10);
    }
    return 0;
  };

  const getCost = (types) => {
    for (const t of types) {
      const match = costPerActions.find(a => a.action_type === t);
      if (match) return parseFloat(match.value).toFixed(2);
    }
    return null;
  };

  // 1. Leads
  const leads = getVal([
    'lead', 
    'onsite_conversion.lead_grouped', 
    'offsite_complete_registration_add_meta_leads',
    'offsite_submit_application_add_meta_leads'
  ]);
  let cpl = getCost(['lead', 'onsite_conversion.lead_grouped', 'offsite_submit_application_add_meta_leads']);
  if (!cpl && leads > 0 && spend > 0) cpl = (spend / leads).toFixed(2);

  // 2. Landing Page Views
  const lpv = getVal(['landing_page_view', 'omni_landing_page_view']);
  let costPerLpv = getCost(['landing_page_view', 'omni_landing_page_view']);
  if (!costPerLpv && lpv > 0 && spend > 0) costPerLpv = (spend / lpv).toFixed(2);

  // 3. Link Clicks
  const linkClicks = getVal(['link_click']) || clicks;

  // 4. Engagements & Video Views
  const engagements = getVal(['post_engagement', 'page_engagement', 'video_view', 'post_interaction_gross']);
  const videoViews = getVal(['video_view']);
  let costPerEngagement = getCost(['post_engagement', 'page_engagement', 'video_view']);
  if (!costPerEngagement && engagements > 0 && spend > 0) costPerEngagement = (spend / engagements).toFixed(2);

  // 5. Conversions & Purchases
  const purchases = getVal(['purchase', 'omni_purchase', 'offsite_complete_registration', 'submit_application']);
  let costPerPurchase = getCost(['purchase', 'omni_purchase', 'submit_application']);
  if (!costPerPurchase && purchases > 0 && spend > 0) costPerPurchase = (spend / purchases).toFixed(2);

  // 6. App Promotion
  const appInstalls = getVal(['app_install', 'mobile_app_install', 'omni_app_install']);
  let costPerAppInstall = getCost(['app_install', 'mobile_app_install', 'omni_app_install']);
  if (!costPerAppInstall && appInstalls > 0 && spend > 0) costPerAppInstall = (spend / appInstalls).toFixed(2);

  return {
    leads,
    costPerLead: cpl,
    landingPageViews: lpv,
    costPerLandingPageView: costPerLpv,
    linkClicks,
    engagements,
    videoViews,
    costPerEngagement,
    purchases,
    costPerPurchase,
    appInstalls,
    costPerAppInstall
  };
}

function determineCampaignCategory(objective, parsedMetrics) {
  const obj = (objective || '').toUpperCase();
  if (obj === 'OUTCOME_LEADS' || obj === 'LEAD_GENERATION' || (parsedMetrics.leads > 0 && obj !== 'OUTCOME_TRAFFIC')) {
    return 'LEAD_GENERATION';
  }
  if (obj === 'OUTCOME_TRAFFIC' || obj === 'LINK_CLICKS' || parsedMetrics.landingPageViews > 0) {
    return 'WEBSITE_VISITS';
  }
  if (obj === 'OUTCOME_AWARENESS' || obj === 'BRAND_AWARENESS' || obj === 'REACH') {
    return 'BRAND_AWARENESS';
  }
  if (obj === 'OUTCOME_ENGAGEMENT' || obj === 'POST_ENGAGEMENT' || obj === 'VIDEO_VIEWS') {
    return 'ENGAGEMENT';
  }
  if (obj === 'OUTCOME_SALES' || obj === 'CONVERSIONS' || obj === 'PRODUCT_CATALOG_SALES' || parsedMetrics.purchases > 0) {
    return 'SALES_CONVERSIONS';
  }
  if (obj === 'OUTCOME_APP_PROMOTION' || obj === 'APP_INSTALLS' || parsedMetrics.appInstalls > 0) {
    return 'APP_PROMOTION';
  }
  return parsedMetrics.leads > 0 ? 'LEAD_GENERATION' : 'WEBSITE_VISITS';
}

/**
 * 2. Get full analytics for a specific Campaign ID
 * Pulls overall campaign metrics, adset breakdowns, ad-level breakdowns,
 * and matches with on-site visitor sessions from SQLite.
 */
async function getCampaignAnalytics(campaignId, options = 'maximum') {
  const token = getAccessToken();

  if (!token) {
    return { success: false, error: 'META_PAGE_ACCESS_TOKEN is not configured.' };
  }

  if (!campaignId) {
    return { success: false, error: 'Campaign ID is required.' };
  }

  let dateParam = 'date_preset=maximum';
  let datePresetLabel = 'maximum';

  if (typeof options === 'string') {
    const p = options.toLowerCase();
    if (p === 'today') { dateParam = 'date_preset=today'; datePresetLabel = 'today'; }
    else if (p === 'yesterday') { dateParam = 'date_preset=yesterday'; datePresetLabel = 'yesterday'; }
    else if (p === 'last_7d' || p === '7d') { dateParam = 'date_preset=last_7d'; datePresetLabel = 'last_7d'; }
    else if (p === 'last_30d' || p === '30d') { dateParam = 'date_preset=last_30d'; datePresetLabel = 'last_30d'; }
    else { dateParam = 'date_preset=maximum'; datePresetLabel = 'maximum'; }
  } else if (typeof options === 'object' && options !== null) {
    if (options.startDate && options.endDate) {
      dateParam = `time_range=${encodeURIComponent(JSON.stringify({ since: options.startDate, until: options.endDate }))}`;
      datePresetLabel = 'custom';
    } else if (options.datePreset) {
      const p = options.datePreset.toLowerCase();
      if (p === 'today') { dateParam = 'date_preset=today'; datePresetLabel = 'today'; }
      else if (p === 'yesterday') { dateParam = 'date_preset=yesterday'; datePresetLabel = 'yesterday'; }
      else if (p === 'last_7d' || p === '7d') { dateParam = 'date_preset=last_7d'; datePresetLabel = 'last_7d'; }
      else if (p === 'last_30d' || p === '30d') { dateParam = 'date_preset=last_30d'; datePresetLabel = 'last_30d'; }
      else { dateParam = 'date_preset=maximum'; datePresetLabel = 'maximum'; }
    }
  }

  try {
    // 1. Fetch Campaign Info
    const campaignInfoUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(campaignId)}?fields=id,name,status,objective,start_time&access_token=${encodeURIComponent(token)}`;
    
    // 2. Fetch Campaign-Level Insights
    const campaignInsightsUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(campaignId)}/insights?fields=spend,impressions,clicks,cpc,ctr,cpm,reach,actions,cost_per_action_type&${dateParam}&access_token=${encodeURIComponent(token)}`;

    // 3. Fetch AdSet-Level Insights
    const adsetInsightsUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(campaignId)}/insights?level=adset&fields=adset_id,adset_name,spend,impressions,clicks,cpc,ctr,reach,actions,cost_per_action_type&${dateParam}&access_token=${encodeURIComponent(token)}`;

    // 4. Fetch Ad-Level Insights with Actions and Costs
    const adInsightsUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(campaignId)}/insights?level=ad&fields=ad_id,ad_name,adset_id,adset_name,spend,impressions,clicks,cpc,ctr,reach,actions,cost_per_action_type&${dateParam}&access_token=${encodeURIComponent(token)}`;

    const [campaignRes, insightsRes, adsetRes, adRes] = await Promise.all([
      httpsGetJson(campaignInfoUrl),
      httpsGetJson(campaignInsightsUrl),
      httpsGetJson(adsetInsightsUrl),
      httpsGetJson(adInsightsUrl)
    ]);

    if (campaignRes.error) {
      return { success: false, error: campaignRes.error.message };
    }

    const campaignInfo = campaignRes;
    const overallInsight = insightsRes.data && insightsRes.data.length > 0 ? insightsRes.data[0] : null;

    const overallSpend = parseFloat(overallInsight?.spend || 0);
    const overallClicks = parseInt(overallInsight?.clicks || 0, 10);
    const overallImpressions = parseInt(overallInsight?.impressions || 0, 10);
    const overallReach = parseInt(overallInsight?.reach || 0, 10);
    const overallParsed = parseMetricsFromActions(
      overallInsight?.actions || [],
      overallInsight?.cost_per_action_type || [],
      overallSpend,
      overallClicks
    );

    const campaignCategory = determineCampaignCategory(campaignInfo.objective, overallParsed);

    const adsets = (adsetRes.data || []).map(as => {
      const sNum = parseFloat(as.spend || 0);
      const cNum = parseInt(as.clicks || 0, 10);
      const asParsed = parseMetricsFromActions(as.actions || [], as.cost_per_action_type || [], sNum, cNum);
      return {
        adset_id: as.adset_id,
        adset_name: as.adset_name,
        spend: sNum.toFixed(2),
        impressions: parseInt(as.impressions || 0, 10),
        clicks: cNum,
        cpc: parseFloat(as.cpc || 0).toFixed(2),
        ctr: parseFloat(as.ctr || 0).toFixed(2),
        reach: parseInt(as.reach || 0, 10),
        leads: asParsed.leads,
        costPerLead: asParsed.costPerLead,
        landingPageViews: asParsed.landingPageViews,
        costPerLandingPageView: asParsed.costPerLandingPageView
      };
    });

    const rawAds = (adRes.data || []).map(ad => {
      const sNum = parseFloat(ad.spend || 0);
      const cNum = parseInt(ad.clicks || 0, 10);
      const impNum = parseInt(ad.impressions || 0, 10);
      const rNum = parseInt(ad.reach || 0, 10);
      const cpcNum = parseFloat(ad.cpc || 0);
      const ctrNum = parseFloat(ad.ctr || 0);
      const adParsed = parseMetricsFromActions(ad.actions || [], ad.cost_per_action_type || [], sNum, cNum);

      let cvr = '0.0';
      if (campaignCategory === 'LEAD_GENERATION' && cNum > 0 && adParsed.leads > 0) {
        cvr = ((adParsed.leads / cNum) * 100).toFixed(1);
      } else if (campaignCategory === 'WEBSITE_VISITS' && cNum > 0 && adParsed.landingPageViews > 0) {
        cvr = ((adParsed.landingPageViews / cNum) * 100).toFixed(1);
      }

      return {
        ad_id: ad.ad_id,
        ad_name: ad.ad_name,
        adset_id: ad.adset_id,
        adset_name: ad.adset_name,
        spend: sNum.toFixed(2),
        impressions: impNum,
        clicks: cNum,
        cpc: cpcNum.toFixed(2),
        ctr: ctrNum.toFixed(2),
        reach: rNum,
        leads: adParsed.leads,
        costPerLead: adParsed.costPerLead,
        landingPageViews: adParsed.landingPageViews,
        costPerLandingPageView: adParsed.costPerLandingPageView,
        engagements: adParsed.engagements,
        costPerEngagement: adParsed.costPerEngagement,
        videoViews: adParsed.videoViews,
        purchases: adParsed.purchases,
        costPerPurchase: adParsed.costPerPurchase,
        appInstalls: adParsed.appInstalls,
        costPerAppInstall: adParsed.costPerAppInstall,
        cvr
      };
    });

    // Determine Top Performer Ad
    let maxGoalValue = -1;
    let topAdId = null;
    rawAds.forEach(ad => {
      let val = 0;
      if (campaignCategory === 'LEAD_GENERATION') val = ad.leads;
      else if (campaignCategory === 'WEBSITE_VISITS') val = ad.landingPageViews;
      else if (campaignCategory === 'BRAND_AWARENESS') val = ad.reach;
      else if (campaignCategory === 'ENGAGEMENT') val = ad.engagements;
      else if (campaignCategory === 'SALES_CONVERSIONS') val = ad.purchases;
      else if (campaignCategory === 'APP_PROMOTION') val = ad.appInstalls;
      if (val > maxGoalValue && val > 0) {
        maxGoalValue = val;
        topAdId = ad.ad_id;
      }
    });

    const ads = rawAds.map(ad => ({
      ...ad,
      isTopPerformer: ad.ad_id === topAdId,
      isZeroConversions: parseFloat(ad.spend) > 100 && (campaignCategory === 'LEAD_GENERATION' ? ad.leads === 0 : (campaignCategory === 'WEBSITE_VISITS' ? ad.landingPageViews === 0 : false))
    }));

    // 5. Query Local Database for Landing Page Traffic associated with this Campaign
    // Matches by utm_campaign, or landing_url containing campaignId, filtered by selected date bounds
    const dateBounds = (typeof options === 'object' && options !== null && options.startDate && options.endDate)
      ? db.resolveDateBounds({ startDate: options.startDate, endDate: options.endDate })
      : db.resolveDateBounds({ period: datePresetLabel });

    const localSessions = db.db.prepare(`
      SELECT 
        session_id, visitor_id, city, region, country, source_app,
        device_type, browser, total_duration_sec, max_scroll_depth_pct,
        sections_viewed, is_converted, lead_id, created_at
      FROM visitor_sessions
      WHERE (utm_campaign LIKE ? OR landing_url LIKE ? OR (utm_source = 'meta' AND ? = '120248039512450384'))
        AND created_at >= ? AND created_at <= ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(`%${campaignId}%`, `%${campaignId}%`, campaignId, dateBounds.since, dateBounds.until);

    const localLeads = db.db.prepare(`
      SELECT 
        lead_id, full_name, phone, school_name, school_role, school_city_district,
        google_sheet_sync_status, crm_sync_status, created_at
      FROM leads
      WHERE (utm_campaign LIKE ? OR fbclid IS NOT NULL)
        AND created_at >= ? AND created_at <= ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(`%${campaignId}%`, dateBounds.since, dateBounds.until);

    // Aggregate Local Traffic Metrics
    const totalWebVisits = localSessions.length;
    const uniqueWebVisitors = new Set(localSessions.map(s => s.visitor_id)).size;
    const totalDuration = localSessions.reduce((sum, s) => sum + (s.total_duration_sec || 0), 0);
    const avgDuration = totalWebVisits > 0 ? Math.round(totalDuration / totalWebVisits) : 0;
    const totalScroll = localSessions.reduce((sum, s) => sum + (s.max_scroll_depth_pct || 0), 0);
    const avgScroll = totalWebVisits > 0 ? Math.round(totalScroll / totalWebVisits) : 0;
    const conversions = localSessions.filter(s => s.is_converted === 1 || s.lead_id).length;

    // Devices & Apps breakdown
    const devices = {};
    const apps = {};
    const cities = {};
    localSessions.forEach(s => {
      const dev = s.device_type || 'Mobile';
      devices[dev] = (devices[dev] || 0) + 1;

      const app = s.source_app || 'Meta Ad';
      apps[app] = (apps[app] || 0) + 1;

      const city = s.city && s.city !== 'Unknown City' ? `${s.city}, ${s.region || ''}`.trim() : 'In-Transit';
      cities[city] = (cities[city] || 0) + 1;
    });

    return {
      success: true,
      campaignId,
      campaignName: campaignInfo.name,
      status: campaignInfo.status,
      objective: campaignInfo.objective,
      campaignCategory,
      startTime: campaignInfo.start_time,
      datePreset: datePresetLabel,
      metaMetrics: {
        spend: overallInsight ? parseFloat(overallInsight.spend || 0).toFixed(2) : '0.00',
        impressions: overallInsight ? parseInt(overallInsight.impressions || 0, 10) : 0,
        clicks: overallInsight ? parseInt(overallInsight.clicks || 0, 10) : 0,
        reach: overallInsight ? parseInt(overallInsight.reach || 0, 10) : 0,
        cpc: overallInsight ? parseFloat(overallInsight.cpc || 0).toFixed(2) : '0.00',
        ctr: overallInsight ? parseFloat(overallInsight.ctr || 0).toFixed(2) : '0.00',
        cpm: overallInsight ? parseFloat(overallInsight.cpm || 0).toFixed(2) : '0.00',
        metaLeadsCount: overallParsed.leads,
        leads: overallParsed.leads,
        costPerLead: overallParsed.costPerLead,
        landingPageViews: overallParsed.landingPageViews,
        costPerLandingPageView: overallParsed.costPerLandingPageView,
        linkClicks: overallParsed.linkClicks,
        engagements: overallParsed.engagements,
        costPerEngagement: overallParsed.costPerEngagement,
        videoViews: overallParsed.videoViews,
        purchases: overallParsed.purchases,
        costPerPurchase: overallParsed.costPerPurchase,
        appInstalls: overallParsed.appInstalls,
        costPerAppInstall: overallParsed.costPerAppInstall
      },
      adsets,
      ads,
      landingPageAnalytics: {
        destinationUrl: 'https://event.mymentorcircle.com/',
        totalVisits: totalWebVisits,
        uniqueVisitors: uniqueWebVisitors,
        avgDurationSec: avgDuration,
        avgScrollPct: avgScroll,
        conversions,
        conversionRate: totalWebVisits > 0 ? ((conversions / totalWebVisits) * 100).toFixed(1) : '0.0',
        devices: Object.entries(devices).map(([device, count]) => ({ device, count })),
        apps: Object.entries(apps).map(([app, count]) => ({ app, count })),
        topCities: Object.entries(cities).map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count).slice(0, 8),
        recentSessions: localSessions.slice(0, 20),
        leads: localLeads
      }
    };

  } catch (err) {
    console.error('[Meta Marketing API Campaign Analytics Error]:', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  listCampaigns,
  getCampaignAnalytics
};
