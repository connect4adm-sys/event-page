/**
 * MMC Career Readiness Grant™ 2027–28 — High-Performance Visitor Tracking Beacon
 * Tracks visitor arrival time, source app, location hints, scroll depth,
 * and section-by-section dwell time with zero UX friction.
 */

(function () {
  'use strict';

  // 1. Session & Visitor ID Generation
  const STORAGE_VID_KEY = '_mmc_vid';
  const STORAGE_SID_KEY = '_mmc_sid';
  const STORAGE_SESSION_TIME_KEY = '_mmc_s_time';
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  function generateId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
  }

  let visitorId = '';
  try {
    visitorId = localStorage.getItem(STORAGE_VID_KEY);
    if (!visitorId) {
      visitorId = generateId('vid');
      localStorage.setItem(STORAGE_VID_KEY, visitorId);
    }
  } catch (e) {
    visitorId = generateId('vid');
  }

  let sessionId = '';
  const now = Date.now();
  try {
    const lastSessionTime = parseInt(sessionStorage.getItem(STORAGE_SESSION_TIME_KEY) || '0', 10);
    sessionId = sessionStorage.getItem(STORAGE_SID_KEY);

    if (!sessionId || (now - lastSessionTime > SESSION_TIMEOUT_MS)) {
      sessionId = generateId('sess');
      sessionStorage.setItem(STORAGE_SID_KEY, sessionId);
    }
    sessionStorage.setItem(STORAGE_SESSION_TIME_KEY, now.toString());
  } catch (e) {
    sessionId = generateId('sess');
  }

  // 2. URL and Attribution Query Parameters
  const urlParams = {};
  try {
    const searchParams = new URLSearchParams(window.location.search);
    for (const [key, value] of searchParams.entries()) {
      urlParams[key] = value;
    }
  } catch (e) {}

  // Device & Environment Hints
  const screenResolution = `${window.screen?.width || 0}x${window.screen?.height || 0}`;
  let timezone = '';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (e) {}

  const deviceType = (window.innerWidth <= 768) ? 'Mobile' : (window.innerWidth <= 1024 ? 'Tablet' : 'Desktop');

  // 3. Section Dwell Tracking Engine
  const sectionDwell = {}; // section_id -> { section_id, name, duration_sec, enters_count, startTime }
  let currentActiveSection = null;
  let currentSectionEnterTime = Date.now();
  let pageStartTime = Date.now();
  let maxScrollDepthPct = 0;
  let isTabVisible = !document.hidden;

  const SECTION_TITLES = {
    'top': 'Hero Section',
    'stats': 'National Scale Statistics',
    'how-to-qualify': 'Qualify Mechanism',
    'grant': 'Grant Structure (₹25K–₹2L)',
    'activities-framework': '10 Approved Activities',
    'programme': 'Implementation Framework',
    'video-sec': 'Leadership Video Spotlight',
    'how': 'Timeline & Onboarding',
    'requirements': 'Eligibility Checklist',
    'gallery': 'Campus Life Gallery',
    'why': 'Why MMC Advantage',
    'about': 'About MMC & Leadership',
    'schools': 'School Network',
    'experiences': 'Video Testimonials',
    'catalogue': 'Topic Catalogue',
    'contact': 'Eligibility Application Form'
  };

  function getSectionRecord(sectionId) {
    if (!sectionDwell[sectionId]) {
      sectionDwell[sectionId] = {
        section_id: sectionId,
        name: SECTION_TITLES[sectionId] || sectionId,
        duration_sec: 0,
        enters_count: 0
      };
    }
    return sectionDwell[sectionId];
  }

  function flushCurrentSectionDwell() {
    if (currentActiveSection && isTabVisible) {
      const now = Date.now();
      const elapsedSec = Math.round((now - currentSectionEnterTime) / 1000);
      if (elapsedSec > 0) {
        const record = getSectionRecord(currentActiveSection);
        record.duration_sec += elapsedSec;
      }
      currentSectionEnterTime = now;
    }
  }

  function switchActiveSection(newSectionId) {
    if (newSectionId === currentActiveSection) return;
    flushCurrentSectionDwell();

    currentActiveSection = newSectionId;
    currentSectionEnterTime = Date.now();

    if (newSectionId) {
      const record = getSectionRecord(newSectionId);
      record.enters_count += 1;
    }
  }

  // Handle Tab Visibility (Pause timers when user minimizes or switches tab)
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      flushCurrentSectionDwell();
      isTabVisible = false;
      sendBeaconData();
    } else {
      isTabVisible = true;
      currentSectionEnterTime = Date.now();
      try {
        sessionStorage.setItem(STORAGE_SESSION_TIME_KEY, Date.now().toString());
      } catch (e) {}
    }
  });

  // Calculate Scroll Depth
  function updateScrollDepth() {
    const docHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight
    );
    const winHeight = window.innerHeight || document.documentElement.clientHeight;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    if (docHeight > winHeight) {
      const currentPct = Math.round(((scrollTop + winHeight) / docHeight) * 100);
      if (currentPct > maxScrollDepthPct) {
        maxScrollDepthPct = Math.min(100, currentPct);
      }
    }
  }
  window.addEventListener('scroll', updateScrollDepth, { passive: true });

  // 4. Observe Sections with IntersectionObserver
  function initSectionObserver() {
    const targetSections = document.querySelectorAll(
      'section[id], div.hero-ladder'
    );

    if (!('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
      // Find the entry with largest intersection ratio
      let mostVisible = null;
      let maxRatio = 0;

      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
          maxRatio = entry.intersectionRatio;
          mostVisible = entry.target.id || 'hero';
        }
      });

      if (mostVisible && maxRatio >= 0.2) {
        switchActiveSection(mostVisible);
      }
    }, {
      threshold: [0.2, 0.4, 0.7]
    });

    targetSections.forEach(section => {
      if (section.id) observer.observe(section);
    });
  }

  // 5. Payload Assembly
  function getPayload(isFinal = false) {
    flushCurrentSectionDwell();
    updateScrollDepth();

    const totalDurationSec = Math.round((Date.now() - pageStartTime) / 1000);
    const sectionsArray = Object.values(sectionDwell).map(s => ({
      section_id: s.section_id,
      name: s.name,
      duration_sec: s.duration_sec,
      enters_count: s.enters_count
    }));

    return {
      session_id: sessionId,
      visitor_id: visitorId,
      landing_url: window.location.href,
      referrer: document.referrer || '',
      query: urlParams,
      screen: screenResolution,
      device_type: deviceType,
      timezone: timezone,
      total_duration_sec: totalDurationSec,
      max_scroll_depth_pct: maxScrollDepthPct,
      sections: sectionsArray,
      current_section: currentActiveSection,
      lead_id: window.__mmc_lead_id || null,
      is_final: isFinal
    };
  }

  // 6. Network Transmission
  function sendInitialPing() {
    const payload = getPayload(false);
    fetch('/api/track/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(function () {});
  }

  function sendBeaconData() {
    const payload = getPayload(true);
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });

    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track/beacon', blob);
    } else {
      fetch('/api/track/beacon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    }
  }

  // 7. Auto-inject session_id into all lead forms
  function attachSessionToForms() {
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
      let hiddenInput = form.querySelector('input[name="session_id"]');
      if (!hiddenInput) {
        hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = 'session_id';
        form.appendChild(hiddenInput);
      }
      hiddenInput.value = sessionId;
    });
  }

  // 8. Lifecycle Hooks
  window.addEventListener('pagehide', sendBeaconData);
  window.addEventListener('beforeunload', sendBeaconData);

  // Periodic heartbeat (every 25s if tab is active)
  setInterval(function () {
    if (isTabVisible) {
      flushCurrentSectionDwell();
      const payload = getPayload(false);
      fetch('/api/track/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function () {});
    }
  }, 25000);

  // Expose global tracker helper for forms
  window.MMCTracker = {
    getSessionId: function () { return sessionId; },
    getVisitorId: function () { return visitorId; },
    setLeadConverted: function (leadId) {
      window.__mmc_lead_id = leadId;
      flushCurrentSectionDwell();
      const payload = getPayload(false);
      payload.lead_id = leadId;
      payload.event_type = 'lead_converted';
      fetch('/api/track/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function () {});
    }
  };

  // Initialize once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initSectionObserver();
      attachSessionToForms();
      setTimeout(sendInitialPing, 300);
    });
  } else {
    initSectionObserver();
    attachSessionToForms();
    setTimeout(sendInitialPing, 300);
  }
})();
