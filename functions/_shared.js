/**
 * Cloudflare Pages Functions — Shared Core Library
 * Supports D1 Database Operations, Scrypt & Password Auth, Google Sheets, LeadsZone CRM Sync, and Analytics.
 */

import crypto from 'node:crypto';

export const DEFAULT_INITIAL_HASH = 'scrypt$7f3b89a1c2e406f890123456789abcde$d874a0ddb29944e58cfd9b0db7d42e8aca1e7860b5932aefb014e4e9a51e5d998b0547fd822ce7a26b8022bf68de932b385a3b7fcf397e5cc34d1eae7a6cb779';
export const DEFAULT_PASSWORD_FALLBACK = 'Mymentorcircle@2026';

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      ...extraHeaders
    }
  });
}

export function getClientIp(request) {
  return request.headers.get('cf-connecting-ip') ||
         request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
         '127.0.0.1';
}

export function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(c => {
    const parts = c.split('=');
    const key = parts.shift()?.trim();
    if (key) {
      try {
        list[key] = decodeURIComponent(parts.join('='));
      } catch {
        list[key] = parts.join('=');
      }
    }
  });
  return list;
}

export function verifyPassword(password, env) {
  if (!password) return false;

  // 1. Direct env variable match (if user configured plain ADMIN_PASSWORD in Cloudflare)
  if (env && env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.trim()) {
    if (password === env.ADMIN_PASSWORD.trim()) return true;
  }

  // 2. Default password direct fallback
  if (password === DEFAULT_PASSWORD_FALLBACK) return true;

  // 3. Scrypt hash verification
  const hashToUse = (env && env.ADMIN_PASSWORD_HASH && env.ADMIN_PASSWORD_HASH.trim()) || DEFAULT_INITIAL_HASH;
  
  // Support both '$' and ':' separators
  const separator = hashToUse.includes('$') ? '$' : ':';
  const parts = hashToUse.split(separator);
  
  if (parts.length === 3 && parts[0] === 'scrypt') {
    try {
      const saltBuf = Buffer.from(parts[1], 'hex');
      const expectedKeyBuf = Buffer.from(parts[2], 'hex');
      const actualKeyBuf = crypto.scryptSync(password, saltBuf, 64);
      if (expectedKeyBuf.length === actualKeyBuf.length && crypto.timingSafeEqual(expectedKeyBuf, actualKeyBuf)) {
        return true;
      }
    } catch (err) {
      console.error('Password verify error:', err);
    }
  }

  return false;
}

export async function verifyAdminSession(request, env) {
  if (!env || !env.DB) return null;

  const cookies = parseCookies(request.headers.get('Cookie') || '');
  let token = cookies.mmc_admin_session;

  if (!token) {
    const authHeader = request.headers.get('Authorization') || '';
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.slice(7).trim();
    }
  }

  if (!token) return null;

  try {
    const session = await env.DB.prepare(
      'SELECT * FROM admin_sessions WHERE token = ? AND expires_at > datetime("now")'
    ).bind(token).first();
    return session || null;
  } catch (err) {
    console.error('Session verify error:', err);
    return null;
  }
}

export async function syncToGoogleSheets(lead, env) {
  const webhookUrl = env.GOOGLE_SHEETS_WEBHOOK_URL;
  if (!webhookUrl || !webhookUrl.trim()) {
    if (env.DB) {
      await env.DB.prepare(
        'UPDATE leads SET google_sheet_sync_status = "NOT_CONFIGURED" WHERE lead_id = ?'
      ).bind(lead.lead_id).run();
      await env.DB.prepare(
        'INSERT INTO sync_logs (lead_id, target, status, error_message, attempted_at) VALUES (?, "GOOGLE_SHEETS", "SKIPPED", "No Webhook URL configured in env", datetime("now"))'
      ).bind(lead.lead_id).run();
    }
    return { success: false, status: 'NOT_CONFIGURED' };
  }

  const startTime = Date.now();
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'MMC-Cloudflare-LeadEngine/1.0' },
      body: JSON.stringify({
        ...lead,
        action: 'append_lead',
        lead
      }),
      signal: AbortSignal.timeout(15000)
    });

    const duration = Date.now() - startTime;
    const text = await res.text();

    if (res.status >= 200 && res.status < 300) {
      if (env.DB) {
        await env.DB.prepare(
          'UPDATE leads SET google_sheet_sync_status = "SYNCED", google_sheet_synced_at = datetime("now"), google_sheet_error = NULL, updated_at = datetime("now") WHERE lead_id = ?'
        ).bind(lead.lead_id).run();
        await env.DB.prepare(
          'INSERT INTO sync_logs (lead_id, target, status, duration_ms, attempted_at) VALUES (?, "GOOGLE_SHEETS", "SUCCESS", ?, datetime("now"))'
        ).bind(lead.lead_id, duration).run();
      }
      return { success: true, status: 'SYNCED', response: text };
    } else {
      const errorMsg = `HTTP ${res.status}: ${text.slice(0, 150)}`;
      if (env.DB) {
        await env.DB.prepare(
          'UPDATE leads SET google_sheet_sync_status = "FAILED", google_sheet_error = ?, updated_at = datetime("now") WHERE lead_id = ?'
        ).bind(errorMsg, lead.lead_id).run();
        await env.DB.prepare(
          'INSERT INTO sync_logs (lead_id, target, status, error_message, duration_ms, attempted_at) VALUES (?, "GOOGLE_SHEETS", "FAILED", ?, ?, datetime("now"))'
        ).bind(lead.lead_id, errorMsg, duration).run();
      }
      return { success: false, status: 'FAILED', message: errorMsg };
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    if (env.DB) {
      await env.DB.prepare(
        'UPDATE leads SET google_sheet_sync_status = "FAILED", google_sheet_error = ?, updated_at = datetime("now") WHERE lead_id = ?'
      ).bind(err.message, lead.lead_id).run();
      await env.DB.prepare(
        'INSERT INTO sync_logs (lead_id, target, status, error_message, duration_ms, attempted_at) VALUES (?, "GOOGLE_SHEETS", "FAILED", ?, ?, datetime("now"))'
      ).bind(lead.lead_id, err.message, duration).run();
    }
    return { success: false, status: 'FAILED', message: err.message };
  }
}

export async function syncToLeadsZone(lead, env) {
  const crmUrl = env.CRM_API_URL || 'https://app.leadszone.ai/api/integrate/a46e4428-cb4c-4a0c-98a5-5af15716d4e0/leads';
  if (!crmUrl || !crmUrl.trim()) {
    if (env.DB) {
      await env.DB.prepare(
        'UPDATE leads SET crm_sync_status = "NOT_CONFIGURED" WHERE lead_id = ?'
      ).bind(lead.lead_id).run();
      await env.DB.prepare(
        'INSERT INTO sync_logs (lead_id, target, status, error_message, attempted_at) VALUES (?, "CRM", "SKIPPED", "No CRM URL configured", datetime("now"))'
      ).bind(lead.lead_id).run();
    }
    return { success: false, status: 'NOT_CONFIGURED' };
  }

  const roleDisplay = lead.school_role === 'Other' && lead.school_role_other
    ? `Other (${lead.school_role_other})`
    : lead.school_role;

  const detailParts = [
    `School: ${lead.school_name}`,
    `Role: ${roleDisplay}`,
    `City: ${lead.school_city_district}`,
    `MMC ID: ${lead.lead_id}`
  ];

  if (lead.utm_source || lead.utm_campaign) {
    detailParts.push(`Source: ${lead.utm_source || 'direct'} / ${lead.utm_campaign || 'none'}`);
  }

  const payload = {
    name: lead.full_name,
    mobile: lead.phone,
    email: lead.email || '',
    detail1: detailParts.join(' | ')
  };

  const startTime = Date.now();
  try {
    const res = await fetch(crmUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'MMC-Cloudflare-LeadEngine/1.0' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000)
    });

    const duration = Date.now() - startTime;
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    if (res.status >= 200 && res.status < 300) {
      const crmRecordId = data && (data.lead_id || data.existing_lead_id)
        ? String(data.lead_id || data.existing_lead_id)
        : null;

      if (env.DB) {
        await env.DB.prepare(
          'UPDATE leads SET crm_sync_status = "SYNCED", crm_record_id = COALESCE(?, crm_record_id), crm_synced_at = datetime("now"), crm_error = NULL, updated_at = datetime("now") WHERE lead_id = ?'
        ).bind(crmRecordId, lead.lead_id).run();
        await env.DB.prepare(
          'INSERT INTO sync_logs (lead_id, target, status, error_message, duration_ms, attempted_at) VALUES (?, "CRM", "SUCCESS", ?, ?, datetime("now"))'
        ).bind(lead.lead_id, `LeadsZone ID: ${crmRecordId || 'Created'}`, duration).run();
      }
      return { success: true, status: 'SYNCED', crmRecordId, response: data || text };
    } else {
      const errorMsg = `LeadsZone HTTP ${res.status}: ${text.slice(0, 150)}`;
      if (env.DB) {
        await env.DB.prepare(
          'UPDATE leads SET crm_sync_status = "FAILED", crm_error = ?, updated_at = datetime("now") WHERE lead_id = ?'
        ).bind(errorMsg, lead.lead_id).run();
        await env.DB.prepare(
          'INSERT INTO sync_logs (lead_id, target, status, error_message, duration_ms, attempted_at) VALUES (?, "CRM", "FAILED", ?, ?, datetime("now"))'
        ).bind(lead.lead_id, errorMsg, duration).run();
      }
      return { success: false, status: 'FAILED', message: errorMsg };
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    if (env.DB) {
      await env.DB.prepare(
        'UPDATE leads SET crm_sync_status = "FAILED", crm_error = ?, updated_at = datetime("now") WHERE lead_id = ?'
      ).bind(err.message, lead.lead_id).run();
      await env.DB.prepare(
        'INSERT INTO sync_logs (lead_id, target, status, error_message, duration_ms, attempted_at) VALUES (?, "CRM", "FAILED", ?, ?, datetime("now"))'
      ).bind(lead.lead_id, err.message, duration).run();
    }
    return { success: false, status: 'FAILED', message: err.message };
  }
}

export function classifyLeadSource(lead) {
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

export async function listLeadsD1(env, {
  search = '',
  role = '',
  status = '',
  gsheetStatus = '',
  crmStatus = '',
  source = '',
  campaign = '',
  city = '',
  startDate = '',
  endDate = '',
  limit = 20,
  offset = 0,
  sortOrder = 'DESC'
} = {}) {
  let whereClauses = [];
  let params = [];

  if (search) {
    whereClauses.push(`(
      full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR 
      school_name LIKE ? OR school_city_district LIKE ? OR lead_id LIKE ?
    )`);
    const q = `%${search}%`;
    params.push(q, q, q, q, q, q);
  }

  if (role) {
    whereClauses.push('school_role = ?');
    params.push(role);
  }

  if (status) {
    whereClauses.push('lead_status = ?');
    params.push(status);
  }

  if (gsheetStatus) {
    whereClauses.push('google_sheet_sync_status = ?');
    params.push(gsheetStatus);
  }

  if (crmStatus) {
    whereClauses.push('crm_sync_status = ?');
    params.push(crmStatus);
  }

  if (source) {
    whereClauses.push('utm_source = ?');
    params.push(source);
  }

  if (campaign) {
    whereClauses.push('utm_campaign = ?');
    params.push(campaign);
  }

  if (city) {
    whereClauses.push('school_city_district LIKE ?');
    params.push(`%${city}%`);
  }

  if (startDate) {
    whereClauses.push('created_at >= ?');
    params.push(startDate);
  }

  if (endDate) {
    whereClauses.push('created_at <= ?');
    params.push(endDate);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const orderDir = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const countQuery = `SELECT COUNT(*) as total FROM leads ${whereSql}`;
  const countRow = await env.DB.prepare(countQuery).bind(...params).first();
  const total = countRow ? countRow.total : 0;

  const dataQuery = `SELECT * FROM leads ${whereSql} ORDER BY created_at ${orderDir} LIMIT ? OFFSET ?`;
  const dataStmt = env.DB.prepare(dataQuery).bind(...params, limit, offset);
  const dataResult = await dataStmt.all();
  const leads = dataResult.results || [];

  return {
    total,
    limit,
    offset,
    leads
  };
}

export async function getDashboardSummaryD1(env, dateRangeDays = 30) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const rangeStart = new Date(Date.now() - dateRangeDays * 24 * 60 * 60 * 1000).toISOString();
  const trendStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [
    totalRow,
    todayRow,
    rangeRow,
    dupRow,
    gsheetRows,
    crmRows,
    roleRows,
    statusRows,
    attributionRows,
    campaignRows,
    trendRows
  ] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as count FROM leads').first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM leads WHERE created_at >= ?').bind(todayStart).first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM leads WHERE created_at >= ?').bind(rangeStart).first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM leads WHERE is_duplicate_suspect = 1').first(),
    env.DB.prepare('SELECT google_sheet_sync_status as status, COUNT(*) as count FROM leads GROUP BY google_sheet_sync_status').all(),
    env.DB.prepare('SELECT crm_sync_status as status, COUNT(*) as count FROM leads GROUP BY crm_sync_status').all(),
    env.DB.prepare('SELECT school_role, COUNT(*) as count FROM leads GROUP BY school_role ORDER BY count DESC').all(),
    env.DB.prepare('SELECT lead_status, COUNT(*) as count FROM leads GROUP BY lead_status ORDER BY count DESC').all(),
    env.DB.prepare('SELECT lead_id, utm_source, utm_medium, utm_campaign, referrer_url, fbclid FROM leads').all(),
    env.DB.prepare('SELECT COALESCE(utm_campaign, "No Campaign Specified") as campaign, COUNT(*) as count FROM leads GROUP BY campaign ORDER BY count DESC LIMIT 10').all(),
    env.DB.prepare('SELECT SUBSTR(created_at, 1, 10) as day, COUNT(*) as count FROM leads WHERE created_at >= ? GROUP BY day ORDER BY day ASC').bind(trendStart).all()
  ]);

  const sourceCounts = {};
  (attributionRows.results || []).forEach(lead => {
    const channel = classifyLeadSource(lead);
    sourceCounts[channel] = (sourceCounts[channel] || 0) + 1;
  });

  const sourceBreakdown = Object.entries(sourceCounts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalLeads: totalRow ? totalRow.count : 0,
    leadsToday: todayRow ? todayRow.count : 0,
    leadsInRange: rangeRow ? rangeRow.count : 0,
    duplicateSuspects: dupRow ? dupRow.count : 0,
    dateRangeDays,
    roleBreakdown: roleRows.results || [],
    statusBreakdown: statusRows.results || [],
    sourceBreakdown,
    campaignBreakdown: campaignRows.results || [],
    submissionTrend: trendRows.results || [],
    gsheetStats: gsheetRows.results || [],
    crmStats: crmRows.results || [],
    integrations: {
      google_sheets: Boolean(env.GOOGLE_SHEETS_WEBHOOK_URL && env.GOOGLE_SHEETS_WEBHOOK_URL.trim()),
      crm: Boolean(env.CRM_API_URL && env.CRM_API_URL.trim()),
      meta_api: {
        configured: Boolean(env.META_ACCESS_TOKEN && env.META_AD_ACCOUNT_ID),
        ad_account_id: env.META_AD_ACCOUNT_ID ? 'act_***' : null
      }
    }
  };
}

export async function getGeographyReportD1(env) {
  const result = await env.DB.prepare(`
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
    records: result.results || []
  };
}

export async function getSchoolReportD1(env) {
  const result = await env.DB.prepare(`
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
    records: result.results || []
  };
}

export async function getMetaAttributionDetailsD1(env) {
  const result = await env.DB.prepare(`
    SELECT 
      lead_id, full_name, school_name, school_role, 
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, created_at
    FROM leads 
    WHERE fbclid IS NOT NULL OR utm_source LIKE '%meta%' OR utm_source LIKE '%facebook%' OR utm_source LIKE '%instagram%'
    ORDER BY created_at DESC
  `).all();

  const metaLeads = result.results || [];
  const campaigns = {};
  metaLeads.forEach(l => {
    const c = l.utm_campaign || 'Unspecified Campaign';
    if (!campaigns[c]) campaigns[c] = { campaign: c, leads: 0, withFbclid: 0 };
    campaigns[c].leads += 1;
    if (l.fbclid) campaigns[c].withFbclid += 1;
  });

  return {
    isMetaApiConnected: Boolean(env.META_ACCESS_TOKEN && env.META_AD_ACCOUNT_ID),
    totalMetaAttributedLeads: metaLeads.length,
    leadsWithClickId: metaLeads.filter(l => l.fbclid).length,
    campaignBreakdown: Object.values(campaigns).sort((a, b) => b.leads - a.leads),
    metaLeads
  };
}
