/**
 * MMC Career Readiness Grant™ 2027–28 — Geolocation & IP Intelligence Module
 * Resolves visitor location (city, region/state, country) efficiently.
 * Prioritizes CDN/reverse-proxy headers, uses in-memory LRU caching,
 * and gracefully handles local development and network fallbacks.
 */

const http = require('node:http');

// In-memory cache for IP lookups: ip -> { city, region, country, isp, cached_at }
const geoCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 5000;

// Common timezone to city hints for local dev
const TZ_HINTS = {
  'Asia/Kolkata': { city: 'New Delhi', region: 'Delhi NCR', country: 'India' },
  'Asia/Calcutta': { city: 'New Delhi', region: 'Delhi NCR', country: 'India' },
  'Asia/Dubai': { city: 'Dubai', region: 'Dubai', country: 'UAE' },
  'America/New_York': { city: 'New York', region: 'NY', country: 'United States' },
  'America/Los_Angeles': { city: 'Los Angeles', region: 'CA', country: 'United States' },
  'Europe/London': { city: 'London', region: 'Greater London', country: 'United Kingdom' }
};

function normalizeIp(rawIp) {
  if (!rawIp) return '127.0.0.1';
  let ip = rawIp.trim();
  if (ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }
  return ip;
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (ip.startsWith('172.')) {
    const parts = ip.split('.');
    const second = parseInt(parts[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/**
 * Extract clean IP from request headers or socket
 */
function extractClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp) return normalizeIp(cfIp);

  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return normalizeIp(first);
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) return normalizeIp(realIp);

  return normalizeIp(req.socket?.remoteAddress);
}

/**
 * Fetch geolocation for an IP address asynchronously from IP-API with fallback
 */
function fetchIpLocation(ip) {
  return new Promise((resolve) => {
    // Check cache
    const cached = geoCache.get(ip);
    if (cached && (Date.now() - cached.cached_at < CACHE_TTL_MS)) {
      return resolve(cached);
    }

    const options = {
      hostname: 'ip-api.com',
      port: 80,
      path: `/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,isp`,
      method: 'GET',
      timeout: 1500 // Quick timeout to never block
    };

    const apiReq = http.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => { data += chunk; });
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.status === 'success') {
            const result = {
              city: parsed.city || 'Unknown City',
              region: parsed.regionName || '',
              country: parsed.country || 'India',
              isp: parsed.isp || '',
              cached_at: Date.now()
            };
            if (geoCache.size > MAX_CACHE_SIZE) {
              const firstKey = geoCache.keys().next().value;
              geoCache.delete(firstKey);
            }
            geoCache.set(ip, result);
            return resolve(result);
          }
        } catch {}
        resolve(null);
      });
    });

    apiReq.on('timeout', () => {
      apiReq.destroy();
      resolve(null);
    });

    apiReq.on('error', () => {
      resolve(null);
    });

    apiReq.end();
  });
}

/**
 * Resolve location using CDN headers -> Local Dev Fallback -> IP Lookup
 */
async function resolveLocation(req, clientHints = {}) {
  // 1. Direct CDN headers (Cloudflare / Vercel / CloudFront)
  const cfCity = req.headers['cf-ipcity'];
  const cfRegion = req.headers['cf-region'];
  const cfCountry = req.headers['cf-ipcountry'];

  if (cfCity) {
    return {
      city: decodeURIComponent(cfCity),
      region: cfRegion ? decodeURIComponent(cfRegion) : '',
      country: cfCountry || 'India',
      isp: 'Cloudflare Edge',
      source: 'CDN_HEADER'
    };
  }

  const vercelCity = req.headers['x-vercel-ip-city'];
  if (vercelCity) {
    return {
      city: decodeURIComponent(vercelCity),
      region: req.headers['x-vercel-ip-country-region'] || '',
      country: req.headers['x-vercel-ip-country'] || 'India',
      isp: 'Vercel Edge',
      source: 'CDN_HEADER'
    };
  }

  const ip = extractClientIp(req);

  // 2. Private/Local Network handling
  if (isPrivateIp(ip)) {
    const tz = clientHints.timezone || '';
    const hint = TZ_HINTS[tz] || { city: 'Local Environment', region: 'Development', country: 'India' };
    return {
      city: clientHints.city_hint || hint.city,
      region: clientHints.region_hint || hint.region,
      country: hint.country,
      isp: 'Local / Internal Network',
      source: 'LOCAL_DEV_HINT'
    };
  }

  // 3. Public IP Lookup
  try {
    const geo = await fetchIpLocation(ip);
    if (geo) {
      return {
        ...geo,
        source: 'IP_LOOKUP'
      };
    }
  } catch {}

  // 4. Default graceful fallback
  return {
    city: 'City Pending Resolution',
    region: 'India',
    country: 'India',
    isp: 'Broadband / Cellular Provider',
    source: 'FALLBACK'
  };
}

module.exports = {
  extractClientIp,
  isPrivateIp,
  resolveLocation
};
