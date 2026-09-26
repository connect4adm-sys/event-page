import { verifyAdminSession, listLeadsD1 } from '../../../_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await verifyAdminSession(request, env);
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const p = url.searchParams;

  try {
    const { leads } = await listLeadsD1(env, {
      search: p.get('search') || '',
      role: p.get('role') || '',
      status: p.get('status') || '',
      limit: 10000,
      offset: 0
    });

    const headers = [
      'Lead ID', 'Created At (UTC)', 'Full Name', 'Phone', 'Email',
      'School Role', 'Role Specification', 'School Name', 'City/District',
      'Consent', 'Consent Version', 'UTM Source', 'UTM Medium', 'UTM Campaign',
      'Meta fbclid', 'Status', 'Sheets Sync Status', 'CRM Sync Status'
    ];

    const csvRows = [headers.join(',')];
    leads.forEach(l => {
      const row = [
        `"${l.lead_id}"`,
        `"${l.created_at}"`,
        `"${(l.full_name || '').replace(/"/g, '""')}"`,
        `"${l.phone}"`,
        `"${l.email || ''}"`,
        `"${(l.school_role || '').replace(/"/g, '""')}"`,
        `"${(l.school_role_other || '').replace(/"/g, '""')}"`,
        `"${(l.school_name || '').replace(/"/g, '""')}"`,
        `"${(l.school_city_district || '').replace(/"/g, '""')}"`,
        l.consent ? 'YES' : 'NO',
        `"${l.consent_version}"`,
        `"${l.utm_source || ''}"`,
        `"${l.utm_medium || ''}"`,
        `"${l.utm_campaign || ''}"`,
        `"${l.fbclid || ''}"`,
        `"${l.lead_status}"`,
        `"${l.google_sheet_sync_status}"`,
        `"${l.crm_sync_status}"`
      ];
      csvRows.push(row.join(','));
    });

    const csvData = csvRows.join('\r\n');
    const dateStr = new Date().toISOString().slice(0, 10);

    return new Response(csvData, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mmc-leads-${dateStr}.csv"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    console.error('Export CSV error:', err);
    return new Response('Failed to export leads', { status: 500 });
  }
}
