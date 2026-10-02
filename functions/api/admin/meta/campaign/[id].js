import { json, verifyAdminSession } from '../../../../_shared.js';

export async function onRequestGet(context) {
  const { request, env, params } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  const campaignId = params.id;
  if (!campaignId) {
    return json({ success: false, error: 'Campaign ID is required.' }, 400);
  }

  const urlObj = new URL(request.url);
  const datePreset = urlObj.searchParams.get('datePreset') || 'maximum';
  const startDate = urlObj.searchParams.get('startDate');
  const endDate = urlObj.searchParams.get('endDate');

  let dateParam = 'date_preset=maximum';
  let datePresetLabel = 'maximum';

  if (startDate && endDate) {
    dateParam = `time_range=${encodeURIComponent(JSON.stringify({ since: startDate, until: endDate }))}`;
    datePresetLabel = 'custom';
  } else {
    const p = (datePreset || '').toLowerCase();
    if (p === 'today') { dateParam = 'date_preset=today'; datePresetLabel = 'today'; }
    else if (p === 'yesterday') { dateParam = 'date_preset=yesterday'; datePresetLabel = 'yesterday'; }
    else if (p === 'last_7d' || p === '7d') { dateParam = 'date_preset=last_7d'; datePresetLabel = 'last_7d'; }
    else if (p === 'last_30d' || p === '30d') { dateParam = 'date_preset=last_30d'; datePresetLabel = 'last_30d'; }
    else { dateParam = 'date_preset=maximum'; datePresetLabel = 'maximum'; }
  }

  const token = env.META_PAGE_ACCESS_TOKEN;
  if (!token) {
    return json({ success: false, error: 'META_PAGE_ACCESS_TOKEN is not configured in Cloudflare environment.' }, 200);
  }

  try {
    const campaignInfoUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(campaignId)}?fields=id,name,status,objective,start_time&access_token=${encodeURIComponent(token)}`;
    const campaignInsightsUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(campaignId)}/insights?fields=spend,impressions,clicks,cpc,ctr,cpm,reach,actions,cost_per_action_type&${dateParam}&access_token=${encodeURIComponent(token)}`;
    const adsetInsightsUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(campaignId)}/insights?level=adset&fields=adset_id,adset_name,spend,impressions,clicks,cpc,ctr,reach&${dateParam}&access_token=${encodeURIComponent(token)}`;
    const adInsightsUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(campaignId)}/insights?level=ad&fields=ad_id,ad_name,adset_id,adset_name,spend,impressions,clicks,cpc,ctr,reach&${dateParam}&access_token=${encodeURIComponent(token)}`;

    const [campaignRes, insightsRes, adsetRes, adRes] = await Promise.all([
      fetch(campaignInfoUrl).then(r => r.json()),
      fetch(campaignInsightsUrl).then(r => r.json()),
      fetch(adsetInsightsUrl).then(r => r.json()),
      fetch(adInsightsUrl).then(r => r.json())
    ]);

    if (campaignRes.error) {
      return json({ success: false, error: campaignRes.error.message }, 200);
    }

    const campaignInfo = campaignRes;
    const overallInsight = insightsRes.data && insightsRes.data.length > 0 ? insightsRes.data[0] : null;

    const adsets = (adsetRes.data || []).map(as => ({
      adset_id: as.adset_id,
      adset_name: as.adset_name,
      spend: parseFloat(as.spend || 0).toFixed(2),
      impressions: parseInt(as.impressions || 0, 10),
      clicks: parseInt(as.clicks || 0, 10),
      cpc: parseFloat(as.cpc || 0).toFixed(2),
      ctr: parseFloat(as.ctr || 0).toFixed(2),
      reach: parseInt(as.reach || 0, 10)
    }));

    const ads = (adRes.data || []).map(ad => ({
      ad_id: ad.ad_id,
      ad_name: ad.ad_name,
      adset_id: ad.adset_id,
      adset_name: ad.adset_name,
      spend: parseFloat(ad.spend || 0).toFixed(2),
      impressions: parseInt(ad.impressions || 0, 10),
      clicks: parseInt(ad.clicks || 0, 10),
      cpc: parseFloat(ad.cpc || 0).toFixed(2),
      ctr: parseFloat(ad.ctr || 0).toFixed(2),
      reach: parseInt(ad.reach || 0, 10)
    }));

    // Compute date bounds for local database filtering
    let since = '2020-01-01T00:00:00.000Z';
    let until = new Date().toISOString();
    if (startDate && endDate) {
      since = startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`;
      until = endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`;
    } else {
      const p = (datePreset || '').toLowerCase();
      if (p === 'today') {
        since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
      } else if (p === 'yesterday') {
        const todayMidnight = new Date(new Date().setHours(0, 0, 0, 0));
        since = new Date(todayMidnight.getTime() - 86400000).toISOString();
        until = new Date(todayMidnight.getTime() - 1).toISOString();
      } else if (p === 'last_7d' || p === '7d') {
        since = new Date(Date.now() - 7 * 86400000).toISOString();
      } else if (p === 'last_30d' || p === '30d') {
        since = new Date(Date.now() - 30 * 86400000).toISOString();
      }
    }

    // Query D1 for visitor sessions and leads matching this campaign within time window
    let localSessions = [];
    let localLeads = [];

    if (env.DB) {
      try {
        const sessRes = await env.DB.prepare(`
          SELECT 
            session_id, visitor_id, city, region, country, source_app,
            device_type, browser, total_duration_sec, max_scroll_depth_pct,
            sections_viewed, is_converted, lead_id, created_at
          FROM visitor_sessions
          WHERE (utm_campaign LIKE ? OR landing_url LIKE ? OR (utm_source = 'meta' AND ? = '120248039512450384'))
            AND created_at >= ? AND created_at <= ?
          ORDER BY created_at DESC
          LIMIT 100
        `).bind(`%${campaignId}%`, `%${campaignId}%`, campaignId, since, until).all();
        localSessions = sessRes.results || [];
      } catch (e) {
        console.warn('D1 sessions query error (table may be empty):', e.message);
      }

      try {
        const leadsRes = await env.DB.prepare(`
          SELECT 
            lead_id, full_name, phone, school_name, school_role, school_city_district,
            google_sheet_sync_status, crm_sync_status, created_at
          FROM leads
          WHERE (utm_campaign LIKE ? OR fbclid IS NOT NULL)
            AND created_at >= ? AND created_at <= ?
          ORDER BY created_at DESC
          LIMIT 50
        `).bind(`%${campaignId}%`, since, until).all();
        localLeads = leadsRes.results || [];
      } catch (e) {
        console.warn('D1 leads query error:', e.message);
      }
    }

    const totalWebVisits = localSessions.length;
    const uniqueWebVisitors = new Set(localSessions.map(s => s.visitor_id)).size;
    const totalDuration = localSessions.reduce((sum, s) => sum + (s.total_duration_sec || 0), 0);
    const avgDuration = totalWebVisits > 0 ? Math.round(totalDuration / totalWebVisits) : 0;
    const totalScroll = localSessions.reduce((sum, s) => sum + (s.max_scroll_depth_pct || 0), 0);
    const avgScroll = totalWebVisits > 0 ? Math.round(totalScroll / totalWebVisits) : 0;
    const conversions = localSessions.filter(s => s.is_converted === 1 || s.lead_id).length;

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

    const actions = overallInsight?.actions || [];
    const costPerActions = overallInsight?.cost_per_action_type || [];

    const leadAction = actions.find(a => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped' || (typeof a.action_type === 'string' && a.action_type.includes('lead')));
    const metaLeadsCount = leadAction ? parseInt(leadAction.value, 10) : 0;

    const cplAction = costPerActions.find(a => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped' || (typeof a.action_type === 'string' && a.action_type.includes('lead')));
    const costPerLead = cplAction ? parseFloat(cplAction.value).toFixed(2) : null;

    const landingPageViewAction = actions.find(a => a.action_type === 'landing_page_view' || a.action_type === 'omni_landing_page_view');
    const landingPageViews = landingPageViewAction ? parseInt(landingPageViewAction.value, 10) : 0;

    const costPerLandingAction = costPerActions.find(a => a.action_type === 'landing_page_view' || a.action_type === 'omni_landing_page_view');
    const costPerLandingPageView = costPerLandingAction ? parseFloat(costPerLandingAction.value).toFixed(2) : null;

    const linkClickAction = actions.find(a => a.action_type === 'link_click');
    const linkClicks = linkClickAction ? parseInt(linkClickAction.value, 10) : (overallInsight ? parseInt(overallInsight.clicks || 0, 10) : 0);

    const isLeadGen = (campaignInfo.objective === 'OUTCOME_LEADS' || campaignInfo.objective === 'LEAD_GENERATION' || metaLeadsCount > 0);
    const campaignCategory = isLeadGen ? 'LEAD_GENERATION' : 'WEBSITE_VISITS';

    return json({
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
        metaLeadsCount,
        costPerLead,
        landingPageViews,
        costPerLandingPageView,
        linkClicks
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
    }, 200);

  } catch (err) {
    console.error('[Cloudflare Campaign Analytics Error]:', err);
    return json({ success: false, error: err.message }, 500);
  }
}
