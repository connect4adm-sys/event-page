import { json, verifyAdminSession, syncToGoogleSheets, syncToLeadsZone } from '../../../_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  const mockLeadgenId = 'test_webhook_' + Date.now();
  const formId = '960355729716288';
  const cleanPhoneDigits = '9876543210';
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const leadId = `lead_${dateStr}_${Math.random().toString(36).substring(2, 8)}`;

  const leadFields = {
    full_name: 'Meta Instant Form Test Lead',
    phone: cleanPhoneDigits,
    email: 'testlead@mymentorcircle.com',
    school_role: 'Principal',
    school_name: 'MMC Career Readiness Partner School',
    school_city_district: 'Greater Noida, UP'
  };

  const schoolNameNorm = leadFields.school_name.toLowerCase().trim();
  const emailNorm = leadFields.email.toLowerCase().trim();

  if (env.DB) {
    try {
      await env.DB.prepare(`
        INSERT INTO leads (
          lead_id, full_name, phone, phone_normalized, email, email_normalized,
          school_role, school_role_other, school_name, school_name_normalized,
          school_city_district, consent, consent_version, utm_source, utm_medium,
          utm_campaign, fbclid, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, NULL, ?, ?,
          ?, 1, 'v1.0-meta-instant-form', 'meta', 'instant_form',
          ?, ?, datetime('now'), datetime('now')
        )
      `).bind(
        leadId, leadFields.full_name, cleanPhoneDigits, cleanPhoneDigits, leadFields.email, emailNorm,
        leadFields.school_role, leadFields.school_name, schoolNameNorm,
        leadFields.school_city_district,
        `form_${formId}`, mockLeadgenId
      ).run();
    } catch (e) {
      console.warn('D1 insert warning:', e.message);
    }
  }

  const leadPayload = {
    lead_id: leadId,
    full_name: leadFields.full_name,
    phone: cleanPhoneDigits,
    phone_normalized: cleanPhoneDigits,
    email: leadFields.email,
    school_role: leadFields.school_role,
    school_name: leadFields.school_name,
    school_city_district: leadFields.school_city_district,
    utm_source: 'meta',
    utm_medium: 'instant_form',
    utm_campaign: `form_${formId}`
  };

  const sheetRes = await syncToGoogleSheets(leadPayload, env);
  const crmRes = await syncToLeadsZone(leadPayload, env);

  return json({
    success: true,
    message: 'Meta Lead Ads webhook simulated successfully on Cloudflare Pages!',
    lead_id: leadId,
    google_sheet: sheetRes,
    crm: crmRes
  }, 200);
}
