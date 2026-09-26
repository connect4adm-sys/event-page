import { json, verifyAdminSession } from '../../../_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  const crmUrl = env.CRM_API_URL || 'https://app.leadszone.ai/api/integrate/a46e4428-cb4c-4a0c-98a5-5af15716d4e0/leads';
  if (!crmUrl || !crmUrl.trim()) {
    return json({
      success: false,
      configured: false,
      message: 'CRM_API_URL is not configured.'
    }, 200);
  }

  const startTime = Date.now();
  try {
    const res = await fetch(crmUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(10000)
    });

    const duration = Date.now() - startTime;
    return json({
      success: res.status < 500,
      status: res.status,
      configured: true,
      duration_ms: duration,
      message: `LeadsZone CRM endpoint reachable! (HTTP ${res.status}, ${duration}ms)`
    }, 200);
  } catch (err) {
    const duration = Date.now() - startTime;
    return json({
      success: false,
      configured: true,
      duration_ms: duration,
      message: `Failed to reach LeadsZone CRM: ${err.message}`
    }, 200);
  }
}
