/**
 * MMC Career Readiness Grant™ 2027–28 — Lead Processing & Validation Module
 * Enforces canonical field validation, normalization, duplicate protection,
 * and reliable database persistence.
 */

const crypto = require('node:crypto');
const db = require('./db');
const sheets = require('./sheets');
const crm = require('./crm');

const ALLOWED_ROLES = [
  'Principal',
  'School Director / Management',
  'Teacher',
  'Career Counsellor',
  'Administrator',
  'Other'
];

/**
 * Normalizes phone numbers to standard 10-digit format for matching.
 */
function normalizePhone(phoneStr) {
  if (!phoneStr) return '';
  const digits = phoneStr.replace(/\D/g, '');
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
}

/**
 * Validates plausible Indian mobile phone number.
 */
function isValidPhone(phoneStr) {
  if (!phoneStr || typeof phoneStr !== 'string') return false;
  const cleaned = phoneStr.trim().replace(/[\s\-]/g, '');
  return /^(\+91|91|0)?[6-9]\d{9}$/.test(cleaned);
}

/**
 * Validates standard email address format.
 */
function isValidEmail(emailStr) {
  if (!emailStr) return true; // Optional field
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailStr.trim());
}

/**
 * Server-side validation of canonical lead submission.
 */
function validateLeadInput(data) {
  const errors = {};

  // 1. Full Name
  const fullName = typeof data.full_name === 'string' ? data.full_name.trim() : '';
  if (!fullName || fullName.length < 2) {
    errors.full_name = 'Please provide your full name (at least 2 characters).';
  } else if (fullName.length > 100) {
    errors.full_name = 'Full name must not exceed 100 characters.';
  }

  // 2. Working phone number
  const phone = typeof data.phone === 'string' ? data.phone.trim() : '';
  if (!phone || !isValidPhone(phone)) {
    errors.phone = 'Please provide a valid 10-digit working phone number (e.g. 9876543210 or +91...).';
  }

  // 3. Working E-mail (Optional)
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  if (email && (!isValidEmail(email) || email.length > 120)) {
    errors.email = 'Please provide a valid email address or leave it blank.';
  }

  // 4. Role in school
  const role = typeof data.school_role === 'string' ? data.school_role.trim() : '';
  if (!role || !ALLOWED_ROLES.includes(role)) {
    errors.school_role = 'Please select a valid role in the school from the options.';
  }

  // 4b. Role other specification
  let roleOther = typeof data.school_role_other === 'string' ? data.school_role_other.trim() : null;
  if (role === 'Other') {
    if (!roleOther || roleOther.length < 2) {
      errors.school_role_other = 'Please specify your role in the school.';
    } else if (roleOther.length > 100) {
      errors.school_role_other = 'Role specification must not exceed 100 characters.';
    }
  } else {
    roleOther = null;
  }

  // 5. School name
  const schoolName = typeof data.school_name === 'string' ? data.school_name.trim() : '';
  if (!schoolName || schoolName.length < 3) {
    errors.school_name = 'Please provide your school name (at least 3 characters).';
  } else if (schoolName.length > 150) {
    errors.school_name = 'School name must not exceed 150 characters.';
  }

  // 6. City / District
  const city = typeof data.school_city_district === 'string' ? data.school_city_district.trim() : '';
  if (!city || city.length < 2) {
    errors.school_city_district = 'Please enter your school’s city or district.';
  } else if (city.length > 100) {
    errors.school_city_district = 'City/district must not exceed 100 characters.';
  }

  // 7. Consent Checkbox
  if (!data.consent || data.consent === 'false' || data.consent === 0) {
    errors.consent = 'Consent is required to submit your school details.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    sanitized: {
      full_name: fullName,
      phone: phone,
      email: email || null,
      school_role: role,
      school_role_other: roleOther,
      school_name: schoolName,
      school_city_district: city,
      consent: Boolean(data.consent),
      consent_version: typeof data.consent_version === 'string' ? data.consent_version.trim() : 'v1.0-2027'
    }
  };
}

/**
 * Creates and records a new lead into the primary SQLite database.
 */
function processNewLead(rawData, ipAddress = null) {
  const validation = validateLeadInput(rawData);
  if (!validation.isValid) {
    return {
      success: false,
      status: 400,
      errors: validation.errors,
      message: 'Validation failed. Please correct the highlighted fields.'
    };
  }

  const { sanitized } = validation;
  const phoneNormalized = normalizePhone(sanitized.phone);
  const schoolNormalized = sanitized.school_name.toLowerCase().trim();
  const emailNormalized = sanitized.email ? sanitized.email.toLowerCase().trim() : null;

  // Duplicate Submission Check:
  // 1. Check if same phone submitted in the last 15 minutes
  const recentLead = db.findRecentMatchingLead(phoneNormalized, schoolNormalized, 15);
  let isDuplicateSuspect = false;
  let duplicateReason = null;

  if (recentLead) {
    // If exact same phone submitted within 15 minutes, flag as suspect duplicate
    isDuplicateSuspect = true;
    duplicateReason = `Recent submission matched phone (${phoneNormalized}) or school within 15 minutes of lead ${recentLead.lead_id}.`;
  }

  // Generate unique internal lead ID: lead_YYYYMMDD_random6
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randStr = crypto.randomBytes(3).toString('hex');
  const leadId = `lead_${dateStr}_${randStr}`;

  // Idempotency key from client or generated
  const idempotencyKey = typeof rawData.idempotency_key === 'string' && rawData.idempotency_key.trim()
    ? rawData.idempotency_key.trim()
    : null;

  // Attribution parameters
  const leadRecord = {
    lead_id: leadId,
    idempotency_key: idempotencyKey,
    full_name: sanitized.full_name,
    phone: sanitized.phone,
    phone_normalized: phoneNormalized,
    email: sanitized.email,
    email_normalized: emailNormalized,
    school_role: sanitized.school_role,
    school_role_other: sanitized.school_role_other,
    school_name: sanitized.school_name,
    school_name_normalized: schoolNormalized,
    school_city_district: sanitized.school_city_district,
    consent: sanitized.consent ? 1 : 0,
    consent_version: sanitized.consent_version,
    landing_page_url: typeof rawData.landing_page_url === 'string' ? rawData.landing_page_url.slice(0, 500) : null,
    referrer_url: typeof rawData.referrer_url === 'string' ? rawData.referrer_url.slice(0, 500) : null,
    utm_source: typeof rawData.utm_source === 'string' ? rawData.utm_source.slice(0, 100) : null,
    utm_medium: typeof rawData.utm_medium === 'string' ? rawData.utm_medium.slice(0, 100) : null,
    utm_campaign: typeof rawData.utm_campaign === 'string' ? rawData.utm_campaign.slice(0, 100) : null,
    utm_content: typeof rawData.utm_content === 'string' ? rawData.utm_content.slice(0, 100) : null,
    utm_term: typeof rawData.utm_term === 'string' ? rawData.utm_term.slice(0, 100) : null,
    fbclid: typeof rawData.fbclid === 'string' ? rawData.fbclid.slice(0, 200) : null,
    lead_status: 'NEW',
    google_sheet_sync_status: sheets.isConfigured().configured ? 'PENDING' : 'NOT_CONFIGURED',
    crm_sync_status: crm.isConfigured().configured ? 'PENDING' : 'NOT_CONFIGURED',
    is_duplicate_suspect: isDuplicateSuspect ? 1 : 0,
    duplicate_reason: duplicateReason,
    ip_address: ipAddress,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const savedLead = db.insertLead(leadRecord);

  return {
    success: true,
    status: 201,
    lead_id: savedLead.lead_id,
    lead: savedLead,
    message: 'School details safely recorded.'
  };
}

module.exports = {
  validateLeadInput,
  processNewLead,
  normalizePhone,
  ALLOWED_ROLES
};
