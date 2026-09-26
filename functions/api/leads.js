import { json, getClientIp, syncToGoogleSheets, syncToLeadsZone, DEFAULT_SHEETS_WEBHOOK_URL, DEFAULT_CRM_API_URL } from '../_shared.js';

const ALLOWED_ROLES = [
  'Principal',
  'School Director / Management',
  'Teacher',
  'Career Counsellor',
  'Administrator',
  'Other'
];

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return digits;
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) return digits.slice(1);
  return null;
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  if (!env.DB) {
    return json({ success: false, message: 'Cloudflare D1 database binding (DB) is missing.' }, 500);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: 'Invalid JSON request payload.' }, 400);
  }

  const errors = {};

  // Validation
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  if (!fullName || fullName.length < 2) errors.full_name = 'Please provide your full name.';

  const normPhone = normalizePhone(body.phone);
  if (!normPhone) errors.phone = 'Please provide a valid 10-digit Indian mobile number.';

  let normEmail = null;
  if (body.email && typeof body.email === 'string' && body.email.trim()) {
    const trimmed = body.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      errors.email = 'Please provide a valid email address or leave it blank.';
    } else {
      normEmail = trimmed.toLowerCase();
    }
  }

  const role = typeof body.school_role === 'string' ? body.school_role.trim() : '';
  if (!ALLOWED_ROLES.includes(role)) errors.school_role = 'Please select a valid school role.';

  let roleOther = typeof body.school_role_other === 'string' ? body.school_role_other.trim() : null;
  if (role === 'Other' && (!roleOther || roleOther.length < 2)) {
    errors.school_role_other = 'Please specify your role in the school.';
  } else if (role !== 'Other') {
    roleOther = null;
  }

  const schoolName = typeof body.school_name === 'string' ? body.school_name.trim() : '';
  if (!schoolName || schoolName.length < 3) errors.school_name = 'Please provide your school name.';

  const city = typeof body.school_city_district === 'string' ? body.school_city_district.trim() : '';
  if (!city || city.length < 2) errors.school_city_district = 'Please enter your school’s city or district.';

  if (!body.consent || body.consent === 'false' || body.consent === 0) {
    errors.consent = 'Consent is required to submit your school details.';
  }

  if (Object.keys(errors).length > 0) {
    return json({ success: false, message: 'Form validation failed.', errors }, 400);
  }

  const clientIp = getClientIp(request);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randArr = new Uint8Array(3);
  crypto.getRandomValues(randArr);
  const randSuffix = Array.from(randArr, b => b.toString(16).padStart(2, '0')).join('');
  const leadId = `lead_${dateStr}_${randSuffix}`;

  const idempotencyKey = typeof body.idempotency_key === 'string' && body.idempotency_key.trim()
    ? body.idempotency_key.trim()
    : null;

  // Duplicate Check in D1
  let isDuplicateSuspect = 0;
  let duplicateReason = null;

  if (idempotencyKey) {
    const existing = await env.DB.prepare('SELECT * FROM leads WHERE idempotency_key = ?').bind(idempotencyKey).first();
    if (existing) {
      return json({
        success: true,
        lead_id: existing.lead_id,
        message: 'Lead received and already confirmed.'
      }, 200);
    }
  }

  // Check recent submission in past 15 mins with same phone
  const recentMatch = await env.DB.prepare(
    'SELECT * FROM leads WHERE phone_normalized = ? AND created_at > datetime("now", "-15 minutes") ORDER BY created_at DESC LIMIT 1'
  ).bind(normPhone).first();

  if (recentMatch) {
    isDuplicateSuspect = 1;
    duplicateReason = `Matches recent submission ${recentMatch.lead_id} within 15 minutes.`;
  }

  const leadRecord = {
    lead_id: leadId,
    idempotency_key: idempotencyKey,
    full_name: fullName,
    phone: String(body.phone).trim(),
    phone_normalized: normPhone,
    email: body.email ? String(body.email).trim() : null,
    email_normalized: normEmail,
    school_role: role,
    school_role_other: roleOther,
    school_name: schoolName,
    school_name_normalized: schoolName.toLowerCase(),
    school_city_district: city,
    consent: 1,
    consent_version: typeof body.consent_version === 'string' ? body.consent_version.trim() : 'v1.0-2027',
    landing_page_url: typeof body.landing_page_url === 'string' ? body.landing_page_url.slice(0, 500) : null,
    referrer_url: typeof body.referrer_url === 'string' ? body.referrer_url.slice(0, 500) : null,
    utm_source: typeof body.utm_source === 'string' ? body.utm_source.slice(0, 100) : null,
    utm_medium: typeof body.utm_medium === 'string' ? body.utm_medium.slice(0, 100) : null,
    utm_campaign: typeof body.utm_campaign === 'string' ? body.utm_campaign.slice(0, 100) : null,
    utm_content: typeof body.utm_content === 'string' ? body.utm_content.slice(0, 100) : null,
    utm_term: typeof body.utm_term === 'string' ? body.utm_term.slice(0, 100) : null,
    fbclid: typeof body.fbclid === 'string' ? body.fbclid.slice(0, 200) : null,
    lead_status: 'NEW',
    google_sheet_sync_status: ((env && env.GOOGLE_SHEETS_WEBHOOK_URL && env.GOOGLE_SHEETS_WEBHOOK_URL.trim()) || DEFAULT_SHEETS_WEBHOOK_URL) ? 'PENDING' : 'NOT_CONFIGURED',
    crm_sync_status: ((env && env.CRM_API_URL && env.CRM_API_URL.trim()) || DEFAULT_CRM_API_URL) ? 'PENDING' : 'NOT_CONFIGURED',
    is_duplicate_suspect: isDuplicateSuspect,
    duplicate_reason: duplicateReason,
    ip_address: clientIp,
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };

  // Insert into Cloudflare D1
  await env.DB.prepare(`
    INSERT INTO leads (
      lead_id, idempotency_key, full_name, phone, phone_normalized,
      email, email_normalized, school_role, school_role_other, school_name,
      school_name_normalized, school_city_district, consent, consent_version,
      landing_page_url, referrer_url, utm_source, utm_medium, utm_campaign,
      utm_content, utm_term, fbclid, lead_status, google_sheet_sync_status,
      crm_sync_status, is_duplicate_suspect, duplicate_reason, ip_address,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
    )
  `).bind(
    leadRecord.lead_id, leadRecord.idempotency_key, leadRecord.full_name, leadRecord.phone, leadRecord.phone_normalized,
    leadRecord.email, leadRecord.email_normalized, leadRecord.school_role, leadRecord.school_role_other, leadRecord.school_name,
    leadRecord.school_name_normalized, leadRecord.school_city_district, leadRecord.consent, leadRecord.consent_version,
    leadRecord.landing_page_url, leadRecord.referrer_url, leadRecord.utm_source, leadRecord.utm_medium, leadRecord.utm_campaign,
    leadRecord.utm_content, leadRecord.utm_term, leadRecord.fbclid, leadRecord.lead_status, leadRecord.google_sheet_sync_status,
    leadRecord.crm_sync_status, leadRecord.is_duplicate_suspect, leadRecord.duplicate_reason, leadRecord.ip_address,
    leadRecord.created_at, leadRecord.updated_at
  ).run();

  // Execute downstream syncs (Google Sheets + LeadsZone CRM) asynchronously in background
  const syncPromise = Promise.allSettled([
    syncToGoogleSheets(leadRecord, env),
    syncToLeadsZone(leadRecord, env)
  ]);

  if (context && typeof context.waitUntil === 'function') {
    context.waitUntil(syncPromise);
  }

  // Return immediately without waiting for third-party HTTP webhooks
  return json({
    success: true,
    lead_id: leadId,
    message: 'Your school details have been successfully received. An MMC programme advisor will reach out to schedule an introductory discussion.',
    google_sheet_sync_status: leadRecord.google_sheet_sync_status,
    crm_sync_status: leadRecord.crm_sync_status
  }, 201);
}
