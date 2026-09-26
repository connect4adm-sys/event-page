import { json, verifyAdminSession, DEFAULT_SHEETS_WEBHOOK_URL } from '../../../_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  const webhookUrl = (env && env.GOOGLE_SHEETS_WEBHOOK_URL && env.GOOGLE_SHEETS_WEBHOOK_URL.trim()) || DEFAULT_SHEETS_WEBHOOK_URL;
  if (!webhookUrl || !webhookUrl.trim()) {
    return json({
      success: false,
      configured: false,
      message: 'GOOGLE_SHEETS_WEBHOOK_URL is not configured.'
    }, 200);
  }

  const testPayload = {
    action: 'ping',
    lead_id: 'test_ping_' + Date.now(),
    full_name: 'MMC Test Ping',
    phone: '9999999999',
    school_role: 'Administrator',
    school_name: 'Test Validation School',
    school_city_district: 'Validation District',
    consent: true,
    created_at: new Date().toISOString()
  };

  const startTime = Date.now();
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'MMC-Cloudflare-LeadEngine/1.0' },
      body: JSON.stringify(testPayload),
      redirect: 'follow',
      signal: AbortSignal.timeout(15000)
    });

    const duration = Date.now() - startTime;
    const bodyText = await res.text();

    if (res.status >= 200 && res.status < 300) {
      return json({
        success: true,
        configured: true,
        duration_ms: duration,
        message: `Google Sheets webhook reachable! (HTTP ${res.status}, ${duration}ms)`,
        response_preview: bodyText.slice(0, 100)
      }, 200);
    } else {
      return json({
        success: false,
        configured: true,
        duration_ms: duration,
        message: `Google Sheets returned HTTP ${res.status}: ${bodyText.slice(0, 100)}`
      }, 200);
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    return json({
      success: false,
      configured: true,
      duration_ms: duration,
      message: `Failed to reach Google Sheets webhook: ${err.message}`
    }, 200);
  }
}
