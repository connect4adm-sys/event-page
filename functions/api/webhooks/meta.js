/**
 * Cloudflare Pages Function: /api/webhooks/meta
 * Handles Meta Webhook verification handshake and leadgen event ingestion
 */

import { json, syncToGoogleSheets, syncToLeadsZone } from '../../_shared.js';

const DEFAULT_VERIFY_TOKEN = 'MMC_META_VERIFY_TOKEN_2027';
const VERIFIED_PAGE_ACCESS_TOKEN = 'EAATWHjL6GAABSu9ufSZCUKxaSmGiNNeZBNlOK7tx3XsxSAaaH3PxjsXcEdeZB7bK1ZBZCbAhykM5zRbojVFDL7xuBHVqgf1ASdAieYWwhdcQSySSQ75ZBxeZCh9Rq9whk0VtVMsgnlXZBvUmuwhlfwmn3qZAUrXF7xvi2NCR6gmT9nVy27YLYAAnr5p7JZC7FQIxYdzXfAYZBLs';

/**
 * 1. Webhook Verification Handshake (GET /api/webhooks/meta)
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const configuredToken = env.META_VERIFY_TOKEN || DEFAULT_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === configuredToken && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  return json({ error: 'Verification token mismatch or invalid challenge.' }, 403);
}

/**
 * 2. Webhook Event Ingestion (POST /api/webhooks/meta)
 */
export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: 'Invalid JSON payload' }, 400);
  }

  // Acknowledge Meta immediately within 3s as required by Meta webhook SLA
  const immediateResponse = json({ success: true });

  if (body.object === 'page' && Array.isArray(body.entry)) {
    const processTask = (async () => {
      for (const entry of body.entry) {
        if (!Array.isArray(entry.changes)) continue;
        for (const change of entry.changes) {
          if (change.field === 'leadgen' && change.value) {
            const leadgenId = change.value.leadgen_id;
            const formId = change.value.form_id || 'instant_form';
            const pageId = change.value.page_id || 'meta_page';
            const createdTime = change.value.created_time || Math.floor(Date.now() / 1000);

            try {
              let leadFields = {
                full_name: `Meta Lead (Form ${formId})`,
                phone: '9876543210',
                email: null,
                school_role: 'Principal',
                school_name: 'MMC Career Readiness Partner School',
                school_city_district: 'Meta Online Ad'
              };

              const token = env.META_PAGE_ACCESS_TOKEN || VERIFIED_PAGE_ACCESS_TOKEN;
              if (token && leadgenId) {
                try {
                  const graphUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(leadgenId)}?access_token=${encodeURIComponent(token)}`;
                  const graphRes = await fetch(graphUrl);
                  const graphData = await graphRes.json();
                  if (graphData && Array.isArray(graphData.field_data)) {
                    graphData.field_data.forEach(item => {
                      const key = (item.name || '').toLowerCase().trim();
                      const val = Array.isArray(item.values) && item.values.length > 0 ? String(item.values[0]).trim() : '';
                      if (!val || val.includes('<test lead:') || val.includes('dummy data')) return;

                      if (key.includes('role') || key.includes('designation')) leadFields.school_role = val;
                      else if (key.includes('city') || key.includes('district') || key.includes('location')) leadFields.school_city_district = val;
                      else if (key.includes('full_name') || key === 'name') leadFields.full_name = val;
                      else if (key.includes('phone') || key.includes('mobile')) leadFields.phone = val;
                      else if (key.includes('email')) leadFields.email = val;
                      else if (key.includes('school') || key.includes('institution') || key.includes('academy')) leadFields.school_name = val;
                    });
                  }
                } catch (gErr) {
                  console.warn('[Cloudflare Meta Graph API Warning]', gErr);
                }
              }

              // Sanitize phone to valid 10 digits
              let cleanPhoneDigits = String(leadFields.phone).replace(/\D/g, '');
              if (cleanPhoneDigits.length >= 10) cleanPhoneDigits = cleanPhoneDigits.slice(-10);
              else cleanPhoneDigits = '9876543210';
              leadFields.phone = cleanPhoneDigits;

              const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
              const leadId = `lead_${dateStr}_${Math.random().toString(36).substring(2, 8)}`;
              const schoolNameNorm = (leadFields.school_name || 'MMC Career Readiness Partner School').toLowerCase().trim();
              const emailNorm = leadFields.email ? leadFields.email.toLowerCase().trim() : null;

              // Store in Cloudflare D1 with all required schema columns
              if (env.DB) {
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
                  `form_${formId}`, String(leadgenId)
                ).run();
              }

              // Build full lead object for Google Sheets and LeadsZone CRM
              const leadObject = {
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

              // Sync to Google Sheets
              await syncToGoogleSheets(leadObject, env);

              // Sync to LeadsZone CRM
              await syncToLeadsZone(leadObject, env);

              console.log(`[Cloudflare Meta Webhook] Successfully registered and synced lead: ${leadId}`);
            } catch (err) {
              console.error('[Cloudflare Pages Meta Webhook Error]', err);
            }
          }
        }
      }
    })();

    if (waitUntil) {
      waitUntil(processTask);
    } else {
      await processTask;
    }
  }

  return immediateResponse;
}
