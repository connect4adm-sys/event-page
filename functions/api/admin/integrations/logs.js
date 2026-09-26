import { json, verifyAdminSession } from '../../../_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return json({ success: false, message: 'Unauthorized. Administrative session required.' }, 401);
  }

  if (!env.DB) {
    return json({ success: false, message: 'Cloudflare D1 database binding (DB) is missing.' }, 500);
  }

  try {
    const countRow = await env.DB.prepare('SELECT COUNT(*) as total FROM leads').first();
    const totalLeads = countRow ? countRow.total : 0;

    const logsResult = await env.DB.prepare(
      'SELECT id, lead_id, target, status, duration_ms, attempted_at, error_message FROM sync_logs ORDER BY id DESC LIMIT 50'
    ).all();

    return json({
      success: true,
      database: {
        type: 'Cloudflare D1 SQL Database',
        id: 'a63cfb65-eb51-4ade-86f7-0154c874fb17',
        binding: 'DB',
        total_leads: totalLeads,
        status: 'CONNECTED',
        concurrency: 'Edge Distributed (Zero Latency Read, WAL Write)'
      },
      logs: logsResult.results || []
    }, 200);
  } catch (err) {
    console.error('Fetch integration logs error:', err);
    return json({ success: false, message: 'Failed to retrieve sync logs.' }, 500);
  }
}
