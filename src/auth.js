/**
 * MMC Career Readiness Grant™ 2027–28 — Authentication & Security Module
 * Secure password hashing via Node.js scrypt with salt & timingSafeEqual.
 * HttpOnly session management with rate-limiting and brute-force lockout.
 */

const crypto = require('node:crypto');
const db = require('./db');

// In-memory failed attempt tracking for brute-force protection
const failedAttempts = new Map(); // ip -> { count, firstFailedAt, lockedUntil }

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes lockout
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Hash a password using scrypt and a cryptographically random salt.
 * Output format: scrypt$<salt_hex>$<derived_key_hex>
 */
function hashPassword(password, salt = null) {
  const saltBuf = salt ? Buffer.from(salt, 'hex') : crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, saltBuf, 64);
  return `scrypt$${saltBuf.toString('hex')}$${derivedKey.toString('hex')}`;
}

/**
 * Constant-time password verification to prevent timing attacks.
 */
function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const saltBuf = Buffer.from(parts[1], 'hex');
  const expectedKeyBuf = Buffer.from(parts[2], 'hex');
  const actualKeyBuf = crypto.scryptSync(password, saltBuf, 64);

  if (expectedKeyBuf.length !== actualKeyBuf.length) return false;
  return crypto.timingSafeEqual(expectedKeyBuf, actualKeyBuf);
}

// Pre-computed default hash for the requested initial password "Mymentorcircle@2026"
// Salt: 7f3b89a1c2e406f890123456789abcde
const DEFAULT_INITIAL_HASH = hashPassword('Mymentorcircle@2026', '7f3b89a1c2e406f890123456789abcde');

function getActiveAdminHash() {
  return process.env.ADMIN_PASSWORD_HASH && process.env.ADMIN_PASSWORD_HASH.trim().length > 0
    ? process.env.ADMIN_PASSWORD_HASH.trim()
    : DEFAULT_INITIAL_HASH;
}

/**
 * Rate limiting check for login attempts from a specific IP.
 */
function checkLoginRateLimit(ip) {
  const now = Date.now();
  const record = failedAttempts.get(ip);
  if (!record) return { allowed: true };

  if (record.lockedUntil && record.lockedUntil > now) {
    const remainingSecs = Math.ceil((record.lockedUntil - now) / 1000);
    return {
      allowed: false,
      locked: true,
      remainingSecs,
      message: `Too many failed attempts. Login locked for ${remainingSecs} seconds.`
    };
  }

  // Clear if lockout expired
  if (record.lockedUntil && record.lockedUntil <= now) {
    failedAttempts.delete(ip);
    return { allowed: true };
  }

  return { allowed: true };
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const record = failedAttempts.get(ip) || { count: 0, firstFailedAt: now, lockedUntil: null };
  record.count += 1;

  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
  }
  failedAttempts.set(ip, record);

  const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - record.count);
  return {
    locked: record.count >= MAX_FAILED_ATTEMPTS,
    attemptsRemaining: remaining
  };
}

function clearFailedLogin(ip) {
  failedAttempts.delete(ip);
}

/**
 * Authenticate credentials and return session token.
 */
function loginAdmin(password, ip) {
  const rateLimit = checkLoginRateLimit(ip);
  if (!rateLimit.allowed) {
    return { success: false, status: 429, message: rateLimit.message };
  }

  const activeHash = getActiveAdminHash();
  const isValid = verifyPassword(password, activeHash);

  if (!isValid) {
    const failInfo = recordFailedLogin(ip);
    if (failInfo.locked) {
      return {
        success: false,
        status: 429,
        message: 'Too many failed login attempts. Account temporarily locked for 15 minutes.'
      };
    }
    return {
      success: false,
      status: 401,
      message: `Invalid password. ${failInfo.attemptsRemaining} attempts remaining before temporary lockout.`
    };
  }

  // Successful login
  clearFailedLogin(ip);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  db.cleanExpiredSessions();
  db.createAdminSession(token, expiresAt, ip);

  return { success: true, token, expiresAt };
}

/**
 * Validate incoming request for admin authorization.
 */
function getSessionFromRequest(req) {
  // Check Cookie header
  const cookieHeader = req.headers.cookie || '';
  const cookies = {};
  cookieHeader.split(';').forEach(c => {
    const [k, v] = c.trim().split('=');
    if (k && v) cookies[k] = decodeURIComponent(v);
  });

  let token = cookies['mmc_admin_session'];

  // Fallback to Authorization header
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      token = parts[1];
    }
  }

  if (!token) return null;

  const session = db.getAdminSession(token);
  return session || null;
}

module.exports = {
  hashPassword,
  verifyPassword,
  loginAdmin,
  getSessionFromRequest,
  DEFAULT_INITIAL_HASH
};
