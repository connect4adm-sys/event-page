/**
 * MMC Career Readiness Grant™ 2027–28 — Source & Device Attribution Module
 * Detects visitor arrival source (e.g. Instagram App, Facebook Ad, WhatsApp),
 * device category, browser family, and operating system.
 */

function parseUserAgent(uaString = '') {
  const ua = uaString.toLowerCase();

  // Device Category
  let deviceType = 'Desktop';
  if (/mobile|android|touch|webos|hpwos/i.test(ua)) {
    deviceType = 'Mobile';
  } else if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) {
    deviceType = 'Tablet';
  }

  // Operating System
  let os = 'Unknown OS';
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) os = 'iOS';
  else if (ua.includes('mac os') || ua.includes('macintosh')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';

  // In-App Browser or Standalone Browser
  let browser = 'Unknown Browser';
  let inApp = null;

  if (ua.includes('instagram')) {
    browser = 'Instagram In-App Browser';
    inApp = 'Instagram';
  } else if (ua.includes('fbav') || ua.includes('fban') || ua.includes('facebook')) {
    browser = 'Facebook In-App Browser';
    inApp = 'Facebook';
  } else if (ua.includes('whatsapp')) {
    browser = 'WhatsApp In-App';
    inApp = 'WhatsApp';
  } else if (ua.includes('linkedinapp')) {
    browser = 'LinkedIn In-App';
    inApp = 'LinkedIn';
  } else if (ua.includes('twitter')) {
    browser = 'X / Twitter In-App';
    inApp = 'Twitter';
  } else if (ua.includes('edg/')) {
    browser = 'Microsoft Edge';
  } else if (ua.includes('chrome') && !ua.includes('edg/')) {
    browser = 'Google Chrome';
  } else if (ua.includes('safari') && !ua.includes('chrome')) {
    browser = 'Apple Safari';
  } else if (ua.includes('firefox')) {
    browser = 'Mozilla Firefox';
  }

  return { deviceType, os, browser, inApp };
}

/**
 * Classify arrival source with precision
 */
function detectTrafficSource(params = {}, referrer = '', userAgent = '') {
  const utmSource = (params.utm_source || '').toLowerCase().trim();
  const utmMedium = (params.utm_medium || '').toLowerCase().trim();
  const utmCampaign = (params.utm_campaign || '').trim();
  const ref = (referrer || '').toLowerCase().trim();
  const hasFbclid = Boolean(params.fbclid);
  const { inApp } = parseUserAgent(userAgent);

  // 1. In-App Browser direct detection
  if (inApp === 'Instagram' || ref.includes('instagram.com')) {
    if (hasFbclid || utmMedium.includes('cpc') || utmMedium.includes('ad')) {
      return { sourceApp: 'Instagram App (Paid Ad)', channel: 'Meta Ads', badge: 'INSTAGRAM_AD' };
    }
    return { sourceApp: 'Instagram App', channel: 'Social Referral', badge: 'INSTAGRAM' };
  }

  if (inApp === 'Facebook' || ref.includes('facebook.com') || ref.includes('fb.me')) {
    if (hasFbclid || utmMedium.includes('cpc') || utmMedium.includes('ad')) {
      return { sourceApp: 'Facebook App (Paid Ad)', channel: 'Meta Ads', badge: 'FACEBOOK_AD' };
    }
    return { sourceApp: 'Facebook App', channel: 'Social Referral', badge: 'FACEBOOK' };
  }

  if (inApp === 'WhatsApp' || ref.includes('whatsapp') || ref.includes('android-app://com.whatsapp')) {
    return { sourceApp: 'WhatsApp Messenger', channel: 'Direct Messaging', badge: 'WHATSAPP' };
  }

  // 2. Click ID indicators
  if (hasFbclid) {
    return { sourceApp: 'Meta Platform (Facebook / Instagram Ad)', channel: 'Meta Ads', badge: 'META_AD' };
  }

  if (params.gclid) {
    return { sourceApp: 'Google Ads (Search/Display)', channel: 'Paid Search', badge: 'GOOGLE_AD' };
  }

  // 3. UTM Parameters
  if (utmSource) {
    if (utmSource.includes('instagram')) {
      return { sourceApp: 'Instagram', channel: utmMedium || 'Social', badge: 'INSTAGRAM' };
    }
    if (utmSource.includes('facebook') || utmSource.includes('meta')) {
      return { sourceApp: 'Facebook / Meta', channel: utmMedium || 'Social', badge: 'FACEBOOK' };
    }
    if (utmSource.includes('whatsapp')) {
      return { sourceApp: 'WhatsApp Campaign', channel: 'Direct / Messaging', badge: 'WHATSAPP' };
    }
    if (utmSource.includes('google')) {
      return { sourceApp: 'Google Search / Ad', channel: utmMedium || 'Search', badge: 'GOOGLE' };
    }
    if (utmSource.includes('linkedin')) {
      return { sourceApp: 'LinkedIn', channel: utmMedium || 'Social', badge: 'LINKEDIN' };
    }
    return { sourceApp: `Campaign: ${params.utm_source}`, channel: utmMedium || 'Campaign', badge: 'CAMPAIGN' };
  }

  // 4. Referrer Inspection
  if (ref) {
    if (ref.includes('google.')) {
      return { sourceApp: 'Google Search (Organic)', channel: 'Organic Search', badge: 'GOOGLE_SEARCH' };
    }
    if (ref.includes('bing.')) {
      return { sourceApp: 'Bing Search', channel: 'Organic Search', badge: 'SEARCH' };
    }
    if (ref.includes('youtube.')) {
      return { sourceApp: 'YouTube', channel: 'Video Referral', badge: 'YOUTUBE' };
    }
    try {
      const parsedRef = new URL(ref);
      if (!parsedRef.hostname.includes('localhost') && !parsedRef.hostname.includes('127.0.0.1')) {
        return { sourceApp: parsedRef.hostname.replace('www.', ''), channel: 'Web Referral', badge: 'REFERRAL' };
      }
    } catch {}
  }

  // 5. Direct / Navigated
  return { sourceApp: 'Direct / Navigated', channel: 'Direct Traffic', badge: 'DIRECT' };
}

module.exports = {
  parseUserAgent,
  detectTrafficSource
};
