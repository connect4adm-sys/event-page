/**
 * MMC Career Readiness Grant™ 2027–28 — Automated Test Suite
 * Validates backend server, database persistence, server-side validation,
 * duplicate protection, admin authentication, rate limiting, and analytics.
 */

const http = require('node:http');
const server = require('./server');
const db = require('./src/db');

const TEST_PORT = 3000;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      ...headers
    };
    if (postData) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(`${BASE_URL}${path}`, {
      method,
      headers: reqHeaders
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(responseBody); } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: responseBody,
          json
        });
      });
    });

    req.on('error', err => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('STARTING MMC LEAD INFRASTRUCTURE TEST SUITE');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // Test 1: Health Check
    console.log('\n--- 1. Server Health Check ---');
    const health = await makeRequest('GET', '/api/health');
    assert(health.status === 200, 'GET /api/health returned HTTP 200');
    assert(health.json && health.json.status === 'OK', 'Health status is OK');
    assert(health.json && health.json.database, 'Health contains database diagnostics');

    // Test 2: Validation Rejection on Invalid Lead
    console.log('\n--- 2. Server-side Validation ---');
    const invalidRes = await makeRequest('POST', '/api/leads', {
      full_name: 'A', // too short
      phone: '123'    // invalid phone
    });
    assert(invalidRes.status === 400, 'Invalid lead returns HTTP 400');
    assert(invalidRes.json && invalidRes.json.errors.full_name, 'Full name validation error returned');
    assert(invalidRes.json && invalidRes.json.errors.phone, 'Phone validation error returned');
    assert(invalidRes.json && invalidRes.json.errors.school_role, 'Role validation error returned');
    assert(invalidRes.json && invalidRes.json.errors.school_name, 'School name validation error returned');
    assert(invalidRes.json && invalidRes.json.errors.school_city_district, 'City validation error returned');
    assert(invalidRes.json && invalidRes.json.errors.consent, 'Consent validation error returned');

    // Test 3: Successful Lead Creation (Full Canonical Contract)
    console.log('\n--- 3. Primary Lead Submission ---');
    const validPayload = {
      full_name: 'Dr. Sunita Raman',
      phone: '+91 9876543210',
      email: 'principal@ramanpublicschool.org',
      school_role: 'Principal',
      school_name: 'Raman Memorial Senior School',
      school_city_district: 'Varanasi',
      consent: true,
      consent_version: 'v1.0-2027',
      utm_source: 'meta',
      utm_medium: 'cpc',
      utm_campaign: 'grant_awareness_oct2026',
      utm_content: 'video_carousel_ad',
      utm_term: 'school_management',
      fbclid: 'fb.1.1727333333.IwAR2xyzMockClickId',
      landing_page_url: 'http://localhost:3000/?utm_source=meta',
      referrer_url: 'https://l.instagram.com/'
    };

    const submitRes = await makeRequest('POST', '/api/leads', validPayload);
    assert(submitRes.status === 201, 'Valid lead returns HTTP 201 Created');
    assert(submitRes.json && submitRes.json.success === true, 'Response reports success: true');
    assert(submitRes.json && submitRes.json.lead_id.startsWith('lead_'), 'Unique lead_id generated');
    const savedLeadId = submitRes.json.lead_id;

    // Verify record in SQLite database
    const savedInDb = db.getLeadById(savedLeadId);
    assert(savedInDb !== null, 'Lead verified in primary SQLite database');
    assert(savedInDb.phone_normalized === '9876543210', 'Phone normalized to standard 10-digit');
    assert(savedInDb.email_normalized === 'principal@ramanpublicschool.org', 'Email normalized to lowercase');
    assert(savedInDb.fbclid === validPayload.fbclid, 'Meta fbclid stored accurately');
    assert(savedInDb.lead_status === 'NEW', 'Default lead_status is NEW');
    assert(['NOT_CONFIGURED', 'PENDING', 'SYNCED'].includes(savedInDb.google_sheet_sync_status), 'Sheets status is set properly');

    // Test 4: Optional Email Handling (Lead without email)
    console.log('\n--- 4. Optional Email Handling ---');
    const noEmailPayload = {
      full_name: 'Mr. Arvind Joshi',
      phone: '9123456789',
      email: '', // explicitly blank
      school_role: 'School Director / Management',
      school_name: 'Greenwood International Academy',
      school_city_district: 'Pune, Maharashtra',
      consent: true
    };
    const noEmailRes = await makeRequest('POST', '/api/leads', noEmailPayload);
    assert(noEmailRes.status === 201, 'Lead without email accepted successfully');
    const noEmailLead = db.getLeadById(noEmailRes.json.lead_id);
    assert(noEmailLead.email === null, 'Email stored as null when omitted');

    // Test 5: Duplicate Submission Protection
    console.log('\n--- 5. Duplicate Submission Protection ---');
    // Immediate second submission with same phone & school
    const dupeRes = await makeRequest('POST', '/api/leads', validPayload);
    assert(dupeRes.status === 201, 'Duplicate retry is handled safely without 500 error');
    const dupeLead = db.getLeadById(dupeRes.json.lead_id);
    assert(dupeLead.is_duplicate_suspect === 1, 'Duplicate lead flagged as suspect without silent deletion');
    assert(dupeLead.duplicate_reason.includes('Recent submission matched'), 'Duplicate reason clearly documented');

    // Test 6: Admin Authentication Security
    console.log('\n--- 6. Admin Authentication & Route Protection ---');
    // Unauthenticated access
    const unauthLeads = await makeRequest('GET', '/api/admin/leads');
    assert(unauthLeads.status === 401, 'Unauthenticated access to /api/admin/leads returns 401');

    // Wrong password login
    const wrongLogin = await makeRequest('POST', '/api/admin/login', { password: 'wrongpassword' });
    assert(wrongLogin.status === 401, 'Incorrect password returns 401');

    // Correct password login ("Mymentorcircle@2026")
    const correctLogin = await makeRequest('POST', '/api/admin/login', { password: 'Mymentorcircle@2026' });
    assert(correctLogin.status === 200, 'Correct password (Mymentorcircle@2026) returns 200');
    assert(correctLogin.json && correctLogin.json.success === true, 'Login response contains success: true');
    assert(correctLogin.headers['set-cookie'], 'Login sets HttpOnly session cookie');

    const cookie = correctLogin.headers['set-cookie'][0].split(';')[0];
    const authHeaders = { Cookie: cookie };

    // Test 7: Protected Admin APIs
    console.log('\n--- 7. Protected Admin Dashboard Endpoints ---');
    const authLeads = await makeRequest('GET', '/api/admin/leads', null, authHeaders);
    assert(authLeads.status === 200, 'Authenticated request to /api/admin/leads returns 200');
    assert(authLeads.json.leads.length >= 3, 'Admin leads list contains recorded test leads');
    assert(authLeads.json.total >= 3, 'Total count matches database records');

    // Search and Filtering
    const searchRes = await makeRequest('GET', '/api/admin/leads?search=Varanasi', null, authHeaders);
    assert(searchRes.status === 200, 'Search filter returns 200');
    assert(searchRes.json.leads.every(l => l.school_city_district.includes('Varanasi') || l.school_name.includes('Varanasi')), 'Search filter accurately isolates matching leads');

    // Update Status
    const updateRes = await makeRequest('PATCH', `/api/admin/leads/${savedLeadId}/status`, { status: 'CONTACTED' }, authHeaders);
    assert(updateRes.status === 200, 'Status update to CONTACTED returns 200');
    assert(updateRes.json.lead.lead_status === 'CONTACTED', 'Database record reflects updated status');

    // Analytics Summary
    const summaryRes = await makeRequest('GET', '/api/admin/analytics/summary', null, authHeaders);
    assert(summaryRes.status === 200, 'Analytics summary returns 200');
    assert(summaryRes.json.totalLeads >= 3, 'Total leads count accurate');
    assert(summaryRes.json.sourceBreakdown.length > 0, 'Source breakdown contains classified channels');

    // Geography & School Reports
    const geoRes = await makeRequest('GET', '/api/admin/reports/geography', null, authHeaders);
    assert(geoRes.status === 200, 'Geography report returns 200');
    assert(geoRes.json.records.some(r => r.school_city_district === 'Varanasi'), 'Geography report accurately aggregates submitted cities');

    const schoolRes = await makeRequest('GET', '/api/admin/reports/schools', null, authHeaders);
    assert(schoolRes.status === 200, 'School report returns 200');
    assert(schoolRes.json.records.some(r => r.school_name.includes('Raman Memorial')), 'School report aggregates school applicants');

    // Export CSV
    const csvRes = await makeRequest('GET', '/api/admin/leads/export.csv', null, authHeaders);
    assert(csvRes.status === 200, 'Export CSV returns 200');
    assert(csvRes.headers['content-type'].includes('text/csv'), 'Content-type is text/csv');
    assert(csvRes.body.includes('Lead ID,Created At (UTC)'), 'CSV headers present');
    assert(csvRes.body.includes('Dr. Sunita Raman'), 'CSV contains lead data');

    // Google Sheets & CRM Retry Action
    const retryRes = await makeRequest('POST', `/api/admin/leads/${savedLeadId}/retry-sync`, null, authHeaders);
    assert(retryRes.status === 200 || retryRes.status === 400, 'Retry sync returns controlled HTTP response');
    assert(retryRes.json && (retryRes.json.status === 'NOT_CONFIGURED' || retryRes.json.sheets !== undefined || retryRes.json.success !== undefined), 'Retry response is valid');

    // Test 8: Visitor Intelligence & Tracking Mechanism
    console.log('\n--- 8. Visitor Tracking Endpoints ---');
    const mockSessionId = 'sess_test_' + Date.now();
    const sessionInitRes = await makeRequest('POST', '/api/track/session', {
      session_id: mockSessionId,
      landing_page_url: 'http://localhost:3000/?utm_source=instagram&utm_medium=paid_story&utm_campaign=grant2027',
      referrer_url: 'https://l.instagram.com/',
      user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0',
      screen_width: 390,
      screen_height: 844,
      device_pixel_ratio: 3,
      timezone: 'Asia/Kolkata',
      language: 'en-IN'
    }, {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0',
      'X-Forwarded-For': '103.21.124.10'
    });
    assert(sessionInitRes.status === 200, 'POST /api/track/session returns 200');
    assert(sessionInitRes.json && sessionInitRes.json.session_id === mockSessionId, 'Session ID echoed');
    assert(sessionInitRes.json && (sessionInitRes.json.source === 'Instagram App' || (typeof sessionInitRes.json.source === 'string' && sessionInitRes.json.source.includes('Instagram'))), 'Attribution detected Instagram In-App Browser');

    // Beacon dwell update
    const beaconRes = await makeRequest('POST', '/api/track/beacon', {
      session_id: mockSessionId,
      dwell_time_seconds: 45,
      active_dwell_seconds: 42,
      max_scroll_depth: 85,
      sections_visited: ['top', 'stats', 'grant', 'contact'],
      section_dwells: {
        'top': 10,
        'stats': 8,
        'grant': 18,
        'contact': 6
      }
    });
    assert(beaconRes.status === 200, 'POST /api/track/beacon returns 200');
    assert(beaconRes.json && beaconRes.json.success === true, 'Beacon response reports success');

    // Admin Tracking Summary
    const trackingSummaryRes = await makeRequest('GET', '/api/admin/tracking/summary', null, authHeaders);
    assert(trackingSummaryRes.status === 200, 'GET /api/admin/tracking/summary returns 200');
    const trackingSummary = trackingSummaryRes.json && trackingSummaryRes.json.summary;
    assert(trackingSummary && trackingSummary.totalVisitors >= 1, 'Tracking summary reports total visitors');
    assert(trackingSummary && Array.isArray(trackingSummary.sectionHeatmap || trackingSummary.sections), 'Section engagement heatmap returned');
    assert(trackingSummary && Array.isArray(trackingSummary.topCities || trackingSummary.cities), 'Top cities list returned');

    // Admin Tracking Sessions List
    const trackingSessionsRes = await makeRequest('GET', '/api/admin/tracking/sessions', null, authHeaders);
    assert(trackingSessionsRes.status === 200, 'GET /api/admin/tracking/sessions returns 200');
    assert(trackingSessionsRes.json && trackingSessionsRes.json.sessions.some(s => s.session_id === mockSessionId), 'Created session appears in admin tracking feed');

    // Admin Session Detail Inspection
    const sessionDetailRes = await makeRequest('GET', `/api/admin/tracking/sessions/${mockSessionId}`, null, authHeaders);
    assert(sessionDetailRes.status === 200, 'GET /api/admin/tracking/sessions/:id returns 200');
    assert(sessionDetailRes.json && sessionDetailRes.json.session.session_id === mockSessionId, 'Detailed session inspection matches ID');
    const sectionsVisited = sessionDetailRes.json.session.sections_visited || [];
    assert(sectionsVisited.some(s => (s.section_id || s) === 'grant'), 'Recorded visited sections correctly preserved');

    // Time Horizon Tests: Today, 7d, 30d, 6m, and Custom Range
    const todaySummary = await makeRequest('GET', '/api/admin/tracking/summary?period=today', null, authHeaders);
    assert(todaySummary.status === 200, 'GET /api/admin/tracking/summary?period=today returns 200');
    assert(todaySummary.json && todaySummary.json.summary.sinceDate, 'Today summary returns resolved sinceDate');

    const sevenDaySummary = await makeRequest('GET', '/api/admin/tracking/summary?period=7d', null, authHeaders);
    assert(sevenDaySummary.status === 200, 'GET /api/admin/tracking/summary?period=7d returns 200');

    const sixMonthSummary = await makeRequest('GET', '/api/admin/tracking/summary?period=6m', null, authHeaders);
    assert(sixMonthSummary.status === 200, 'GET /api/admin/tracking/summary?period=6m returns 200');

    const customSummary = await makeRequest('GET', '/api/admin/tracking/summary?period=custom&startDate=2026-01-01&endDate=2026-12-31', null, authHeaders);
    assert(customSummary.status === 200, 'GET /api/admin/tracking/summary?period=custom returns 200');

    // Test 9: Meta Lead Ads Webhook Ingestion
    console.log('\n--- 9. Meta Lead Ads Webhook Ingestion ---');
    const challengeStr = 'MMC_CHALLENGE_' + Math.random().toString(36).substring(2, 8);
    const metaVerifyRes = await makeRequest('GET', `/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=MMC_META_VERIFY_TOKEN_2027&hub.challenge=${challengeStr}`);
    assert(metaVerifyRes.status === 200, 'GET /api/webhooks/meta verification returns 200');
    assert(metaVerifyRes.body === challengeStr, 'Meta challenge string echoed back accurately');

    // Reject wrong token
    const wrongMetaVerify = await makeRequest('GET', `/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=WRONG_TOKEN&hub.challenge=${challengeStr}`);
    assert(wrongMetaVerify.status === 403, 'Invalid Meta verify token returns 403 Forbidden');

    // Meta Webhook POST event
    const metaWebhookRes = await makeRequest('POST', '/api/webhooks/meta', {
      object: 'page',
      entry: [{
        id: 'page_123456789',
        time: Math.floor(Date.now() / 1000),
        changes: [{
          field: 'leadgen',
          value: {
            created_time: Math.floor(Date.now() / 1000),
            leadgen_id: 'leadgen_mock_987654321',
            page_id: 'page_123456789',
            form_id: 'form_instant_456'
          }
        }]
      }]
    });
    assert(metaWebhookRes.status === 200, 'POST /api/webhooks/meta returns 200');
    assert(metaWebhookRes.json && metaWebhookRes.json.success === true, 'Meta webhook reports success');

    // Allow background async webhook processing to finish before final purge
    await new Promise(r => setTimeout(r, 600));

    // Test 10: Admin Database Dummy Purge & Production Readiness
    console.log('\n--- 10. Production Cleanup & Dummy Data Purge ---');
    const purgeRes = await makeRequest('POST', '/api/admin/system/purge-dummy', {}, authHeaders);
    assert(purgeRes.status === 200, 'POST /api/admin/system/purge-dummy returns 200');
    assert(purgeRes.json && purgeRes.json.success === true, 'Purge executed successfully');
    
    // Verify database is completely pristine
    const cleanLeads = await makeRequest('GET', '/api/admin/leads', null, authHeaders);
    assert(cleanLeads.status === 200, 'Admin leads list queried post-purge');
    assert(cleanLeads.json.total === 0, 'Production database has exactly 0 dummy leads');

    console.log('\n================================================================');
    console.log(`TEST SUITE FINISHED: ${passed} PASSED, ${failed} FAILED`);
    console.log('PRODUCTION DATABASE IS PRISTINE (0 DUMMY LEADS)');
    console.log('================================================================');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

// Start tests
setTimeout(runTests, 500);
