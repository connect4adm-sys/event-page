import { json, verifyAdminSession } from '../../../_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  const token = env.META_PAGE_ACCESS_TOKEN;
  const adAccountId = (env.META_AD_ACCOUNT_ID || '957502740459700').replace(/^act_/, '');

  if (!token || !adAccountId) {
    return json({
      success: false,
      error: 'META_PAGE_ACCESS_TOKEN or META_AD_ACCOUNT_ID is not configured in Cloudflare environment variables.',
      campaigns: []
    }, 200);
  }

  try {
    const url = `https://graph.facebook.com/v19.0/act_${encodeURIComponent(adAccountId)}/campaigns?fields=id,name,status,objective,start_time&limit=50&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const result = await res.json();

    if (result.error) {
      console.warn('[Cloudflare Meta API Error]:', result.error.message);
      return json({ success: false, error: result.error.message, campaigns: [] }, 200);
    }

    const campaigns = (result.data || []).map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      objective: c.objective,
      start_time: c.start_time
    }));

    return json({ success: true, campaigns }, 200);
  } catch (err) {
    console.error('[Cloudflare Meta Campaigns Error]:', err);
    return json({ success: false, error: err.message, campaigns: [] }, 500);
  }
}
