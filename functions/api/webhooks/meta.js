/**
 * Cloudflare Pages Function: /api/webhooks/meta
 * Handles Meta Webhook verification handshake and leadgen event ingestion
 */

import { json, syncToGoogleSheets, syncToLeadsZone } from '../../_shared.js';

const DEFAULT_VERIFY_TOKEN = 'MMC_META_VERIFY_TOKEN_2027';

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
    // Process lead in background if waitUntil is available
    const processTask = (async () => {
      for (const entry of body.entry) {
        if (!Array.isArray(entry.changes)) continue;
        for (const change of entry.changes) {
          if (change.field === 'leadgen' && change.value) {
            const leadgenId = change.value.leadgen_id;
            const formId = change.value.form_id;
            const pageId = change.value.page_id;

            // Form Whitelist Filter: Ignore any forms not in META_ALLOWED_FORM_IDS
            const allowedFormIds = (env.META_ALLOWED_FORM_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
            if (allowedFormIds.length > 0 && !allowedFormIds.includes(String(formId))) {
              console.log(`[Cloudflare Meta Webhook] Ignored lead from Form ID: ${formId}`);
              continue;
            }

            try {
              let leadFields = {
                full_name: 'Meta Lead Ad Applicant',
                phone: '9999999999',
                email: null,
                school_role: 'Principal',
                school_name: 'Meta Ad Lead School',
                school_city_district: 'Meta Online Ad'
              };

              // If Page Access Token is configured in Cloudflare environment
              if (env.META_PAGE_ACCESS_TOKEN) {
                const graphUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(leadgenId)}?access_token=${encodeURIComponent(env.META_PAGE_ACCESS_TOKEN)}`;
                const graphRes = await fetch(graphUrl);
                const graphData = await graphRes.json();
                if (graphData && Array.isArray(graphData.field_data)) {
                  graphData.field_data.forEach(item => {
                    const key = (item.name || '').toLowerCase().trim();
                    const val = Array.isArray(item.values) && item.values.length > 0 ? item.values[0] : '';
                    if (key.includes('full_name') || key === 'name') leadFields.full_name = val;
                    else if (key.includes('phone') || key.includes('mobile')) leadFields.phone = val;
                    else if (key.includes('email')) leadFields.email = val;
                    else if (key.includes('school_name') || key.includes('school')) leadFields.school_name = val;
                    else if (key.includes('role')) leadFields.school_role = val;
                    else if (key.includes('city') || key.includes('town')) leadFields.school_city_district = val;
                  });
                }
              }

              // Store in Cloudflare D1 if binding exists
              const leadId = `lead_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
              if (env.DB) {
                await env.DB.prepare(`
                  INSERT INTO leads (
                    lead_id, full_name, phone, phone_normalized, email,
                    school_role, school_name, school_city_district, consent, consent_version,
                    utm_source, utm_medium, utm_campaign, fbclid, created_at, updated_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'v1.0-meta-instant-form', 'meta', 'instant_form', ?, ?, ?, ?)
                `).bind(
                  leadId, leadFields.full_name, leadFields.phone, leadFields.phone.replace(/\\D/g, '').slice(-10), leadFields.email,
                  leadFields.school_role, leadFields.school_name, leadFields.school_city_district,
                  `form_${formId || 'leadgen'}`, leadgenId, new Date().toISOString(), new Date().toISOString()
                ).run();
              }

              // Sync to Google Sheets
              await syncToGoogleSheets(leadFields, env);

              // Sync to LeadsZone CRM
              await syncToLeadsZone(leadFields, env);
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
