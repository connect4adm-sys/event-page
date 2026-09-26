/* ============================================================
   NAV scroll state
   ============================================================ */
(function(){
  const nav = document.getElementById('nav');
  const onScroll = () => {
    nav.classList.toggle('scrolled', window.scrollY > 24);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, {passive:true});
})();

/* ============================================================
   Mobile menu (with backdrop + Escape + outside click)
   ============================================================ */
(function(){
  const toggle = document.getElementById('navToggle');
  const menu = document.getElementById('mobileMenu');
  const backdrop = document.getElementById('menuBackdrop');
  const body = document.body;

  const open = () => {
    toggle.classList.add('open'); menu.classList.add('open'); backdrop.classList.add('open');
    toggle.setAttribute('aria-expanded','true');
    menu.setAttribute('aria-hidden','false');
    body.style.overflow = 'hidden';
  };
  const close = () => {
    toggle.classList.remove('open'); menu.classList.remove('open'); backdrop.classList.remove('open');
    toggle.setAttribute('aria-expanded','false');
    menu.setAttribute('aria-hidden','true');
    body.style.overflow = '';
  };
  const isOpen = () => menu.classList.contains('open');

  toggle.addEventListener('click', () => isOpen() ? close() : open());
  backdrop.addEventListener('click', close);
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });

  window.addEventListener('resize', () => { if (window.innerWidth > 1024 && isOpen()) close(); });
})();

/* ============================================================
   Reveal on scroll (generic)
   ============================================================ */
(function(){
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  }, {threshold: 0.14, rootMargin: '0px 0px -8% 0px'});
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
})();

/* ============================================================
   Stats count-up
   ============================================================ */
(function(){
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const counters = document.querySelectorAll('[data-count]');
  const animate = (el) => {
    const target = parseInt(el.dataset.count, 10);
    if (reduce) { el.textContent = target.toLocaleString('en-IN'); return; }
    const dur = 1600;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased).toLocaleString('en-IN');
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { animate(e.target); io.unobserve(e.target); }
    });
  }, {threshold: 0.5});
  counters.forEach(c => io.observe(c));
})();

/* ============================================================
   Timeline stagger
   ============================================================ */
(function(){
  const steps = document.querySelectorAll('.tl-step');
  const track = document.getElementById('timelineTrack');
  if (!track || !steps.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        steps.forEach((s, i) => setTimeout(() => s.classList.add('in'), i * 90));
        io.disconnect();
      }
    });
  }, {threshold: 0.15});
  io.observe(track);
})();

/* ============================================================
   Grant scale + tiers reveal
   ============================================================ */
(function(){
  const scale = document.getElementById('grantScale');
  if (!scale) return;
  const tiers = scale.querySelectorAll('.tier');
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        scale.classList.add('in');
        tiers.forEach((t, i) => setTimeout(() => t.classList.add('in'), 220 + i * 110));
        io.disconnect();
      }
    });
  }, {threshold: 0.3});
  io.observe(scale);
})();

/* ============================================================
   Subtle parallax on gallery (desktop only, reduced-motion safe)
   ============================================================ */
(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (window.matchMedia('(max-width: 900px)').matches) return; // skip on mobile for perf
  const items = document.querySelectorAll('.gal-item img');
  if (!items.length) return;
  let ticking = false;
  const update = () => {
    const vh = window.innerHeight;
    items.forEach(img => {
      const rect = img.parentElement.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > vh) return;
      const progress = (rect.top + rect.height/2 - vh/2) / vh;
      const shift = progress * 22;
      img.style.transform = `translate3d(0, ${shift}px, 0) scale(1.12)`;
    });
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, {passive:true});
  update();
})();

/* ============================================================
   Footer year
   ============================================================ */
document.getElementById('year').textContent = new Date().getFullYear();

/* ============================================================
   MMC Short-Video Gallery & Modal Controller
   ============================================================ */
(function() {
  const grid = document.getElementById('videoGalleryGrid');
  const toggleBtn = document.getElementById('btnToggleVideos');
  const modalBackdrop = document.getElementById('videoModalBackdrop');
  const modalDialog = document.getElementById('videoModalDialog');
  const modalVideo = document.getElementById('modalVideoPlayer');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalTitle = document.getElementById('modalVideoTitle');
  const modalBadge = document.getElementById('modalVideoBadge');
  const modalTapFallback = document.getElementById('modalTapFallback');

  if (!grid || !modalBackdrop || !modalVideo) return;

  const cards = Array.from(grid.querySelectorAll('.short-video-card'));
  let lastFocusedCard = null;
  let isExpanded = false;

  const isMobile = () => window.innerWidth <= 1024;

  // Initialize all preview videos: strictly muted, loop, playsinline
  cards.forEach(card => {
    const video = card.querySelector('video');
    if (video) {
      video.muted = true;
      video.defaultMuted = true;
      video.setAttribute('muted', '');
      video.playsInline = true;
      video.setAttribute('playsinline', '');
    }
  });

  // High-Performance On-Demand Video Preview:
  // Prevents concurrent multi-video bandwidth choking by allowing AT MOST 1 active preview stream
  let activePreviewVideo = null;
  let hoverTimeout = null;

  const playVideo = (video) => {
    if (!video) return;
    if (activePreviewVideo && activePreviewVideo !== video) {
      pauseVideo(activePreviewVideo);
    }
    activePreviewVideo = video;
    if (video.dataset.src && !video.src) {
      video.src = video.dataset.src;
      video.load();
    }
    video.muted = true;
    const p = video.play();
    if (p !== undefined) {
      p.catch(() => {});
    }
  };

  const pauseVideo = (video) => {
    if (!video) return;
    video.pause();
    if (activePreviewVideo === video) {
      activePreviewVideo = null;
    }
  };

  // 1. Desktop: Instant smooth preview on hover (with 120ms debounce to ignore fast mouse passing)
  cards.forEach(card => {
    const video = card.querySelector('video');
    if (!video) return;

    card.addEventListener('mouseenter', () => {
      if (modalBackdrop.classList.contains('is-active')) return;
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        playVideo(video);
      }, 120);
    });

    card.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimeout);
      pauseVideo(video);
    });
  });

  // 2. Mobile: Only preview the SINGLE card most centered in viewport, never 6-12 cards in parallel
  const io = new IntersectionObserver((entries) => {
    if (modalBackdrop.classList.contains('is-active')) return;

    if (!isMobile()) {
      // On desktop, pause videos when they leave the viewport completely
      entries.forEach(entry => {
        if (!entry.isIntersecting) {
          const v = entry.target.querySelector('video');
          if (v && v === activePreviewVideo) pauseVideo(v);
        }
      });
      return;
    }

    const visibleCards = entries.filter(e => {
      if (!e.isIntersecting) {
        const v = e.target.querySelector('video');
        if (v && v === activePreviewVideo) pauseVideo(v);
        return false;
      }
      const isHidden = e.target.classList.contains('is-collapsed') && !isExpanded;
      const isHiddenMobile = e.target.classList.contains('is-collapsed-mobile') && !isExpanded;
      return !isHidden && !isHiddenMobile;
    });

    if (visibleCards.length > 0) {
      const viewportCenter = window.innerHeight / 2;
      let closestCard = visibleCards[0].target;
      let minDistance = Infinity;

      visibleCards.forEach(e => {
        const rect = e.target.getBoundingClientRect();
        const cardCenter = rect.top + rect.height / 2;
        const dist = Math.abs(cardCenter - viewportCenter);
        if (dist < minDistance) {
          minDistance = dist;
          closestCard = e.target;
        }
      });

      const videoToPlay = closestCard.querySelector('video');
      if (videoToPlay && videoToPlay !== activePreviewVideo) {
        playVideo(videoToPlay);
      }
    }
  }, {
    threshold: 0.5
  });

  cards.forEach(card => io.observe(card));

  // Toggle "View all experiences" / "Show fewer experiences"
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      isExpanded = !isExpanded;
      grid.classList.toggle('is-expanded', isExpanded);
      toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      
      const btnText = toggleBtn.querySelector('.btn-text');
      if (btnText) {
        btnText.textContent = isExpanded ? 'Show fewer experiences' : 'View all experiences';
      }

      // If expanding, ensure all newly revealed cards load and observe
      if (isExpanded) {
        cards.forEach(card => {
          const video = card.querySelector('video');
          if (video && video.dataset.src && !video.src) {
            video.src = video.dataset.src;
            video.load();
          }
          // Check intersection
          const rect = card.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            playVideo(video);
          }
        });
      } else {
        // Collapsing: pause hidden cards
        cards.forEach(card => {
          const isHidden = card.classList.contains('is-collapsed');
          const isHiddenMobile = card.classList.contains('is-collapsed-mobile') && isMobile();
          if (isHidden || isHiddenMobile) {
            const video = card.querySelector('video');
            pauseVideo(video);
          }
        });
        // Smoothly scroll back to section heading if user scrolled way down
        const section = document.getElementById('experiences');
        if (section) {
          const rect = section.getBoundingClientRect();
          if (rect.top < 0) {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      }
    });
  }

  // Card click -> Open Centered Modal with Sound
  cards.forEach(card => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      openModal(card);
    });
  });

  function openModal(card) {
    lastFocusedCard = card;

    // Pause all gallery previews
    cards.forEach(c => {
      const v = c.querySelector('video');
      pauseVideo(v);
    });

    const videoSrc = card.dataset.src || card.querySelector('video')?.src;
    const titleText = card.querySelector('.card-title')?.textContent || 'MMC Real Experience';
    const badgeText = card.querySelector('.card-badge span:last-child')?.textContent || 'Experience';

    if (modalTitle) modalTitle.textContent = titleText;
    if (modalBadge) modalBadge.textContent = badgeText;
    if (modalTapFallback) modalTapFallback.classList.remove('is-active');

    // Load video in modal
    modalVideo.pause();
    modalVideo.removeAttribute('src');
    modalVideo.src = videoSrc;
    modalVideo.currentTime = 0;
    modalVideo.muted = false;
    modalVideo.volume = 1;

    // Open modal backdrop & lock scroll
    modalBackdrop.classList.add('is-active');
    document.body.classList.add('video-modal-open');

    // User gesture playback with sound
    const playPromise = modalVideo.play();
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        // If sound autoplay is blocked by browser policy without unmuting interaction
        if (modalTapFallback) modalTapFallback.classList.add('is-active');
        modalVideo.muted = true;
        modalVideo.play().catch(() => {});
      });
    }

    // Set focus
    setTimeout(() => {
      modalCloseBtn?.focus();
    }, 100);
  }

  function closeModal() {
    if (!modalBackdrop.classList.contains('is-active')) return;

    modalBackdrop.classList.remove('is-active');
    document.body.classList.remove('video-modal-open');

    modalVideo.pause();
    modalVideo.removeAttribute('src');
    modalVideo.load();
    if (modalTapFallback) modalTapFallback.classList.remove('is-active');

    // Resume muted preview for cards in viewport
    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      const isHidden = card.classList.contains('is-collapsed') && !isExpanded;
      const isHiddenMobile = card.classList.contains('is-collapsed-mobile') && isMobile() && !isExpanded;
      if (rect.top < window.innerHeight && rect.bottom > 0 && !isHidden && !isHiddenMobile) {
        const v = card.querySelector('video');
        playVideo(v);
      }
    });

    if (lastFocusedCard) {
      lastFocusedCard.focus();
    }
  }

  // Fallback tap button
  if (modalTapFallback) {
    modalTapFallback.addEventListener('click', () => {
      modalVideo.muted = false;
      modalVideo.volume = 1;
      modalVideo.play().then(() => {
        modalTapFallback.classList.remove('is-active');
      }).catch(() => {});
    });
  }

  // Close triggers
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeModal();
    });
  }

  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) {
      closeModal();
    }
  });

  // Keyboard navigation & trap
  document.addEventListener('keydown', (e) => {
    if (!modalBackdrop.classList.contains('is-active')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }

    if (e.key === 'Tab') {
      const focusables = Array.from(modalDialog.querySelectorAll('button, video, [tabindex="0"]'))
        .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (!focusables.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // Pause preview videos when tab is hidden, resume when tab is active
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cards.forEach(c => pauseVideo(c.querySelector('video')));
      if (modalBackdrop.classList.contains('is-active')) {
        modalVideo.pause();
      }
    } else {
      if (!modalBackdrop.classList.contains('is-active')) {
        cards.forEach(card => {
          const rect = card.getBoundingClientRect();
          const isHidden = card.classList.contains('is-collapsed') && !isExpanded;
          const isHiddenMobile = card.classList.contains('is-collapsed-mobile') && isMobile() && !isExpanded;
          if (rect.top < window.innerHeight && rect.bottom > 0 && !isHidden && !isHiddenMobile) {
            playVideo(card.querySelector('video'));
          }
        });
      }
    }
  });

  // Resize handler for responsive initial card counts
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (!isExpanded) {
        cards.forEach(card => {
          const isHidden = card.classList.contains('is-collapsed');
          const isHiddenMobile = card.classList.contains('is-collapsed-mobile') && isMobile();
          if (isHidden || isHiddenMobile) {
            pauseVideo(card.querySelector('video'));
          }
        });
      }
    }, 150);
  });
})();

/* ============================================================
   MMC School Logos Marquee Controller
   ============================================================ */
(function() {
  const marqueeWrapper = document.querySelector('.schools-marquee-wrapper');
  if (!marqueeWrapper) return;

  const rows = Array.from(marqueeWrapper.querySelectorAll('.school-marquee-row'));

  function checkAndEnsureRunway() {
    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (isReduced) return;

    rows.forEach(row => {
      const track = row.querySelector('.school-marquee-track');
      const firstGroup = row.querySelector('.school-marquee-group');
      if (!track || !firstGroup) return;

      const groupWidth = firstGroup.getBoundingClientRect().width;
      if (groupWidth === 0) return;

      // Ensure track has enough clones so that after translating by 1 group,
      // the remaining content always exceeds window width + 200px buffer
      const minRunway = window.innerWidth + groupWidth + 200;
      const copiesNeeded = Math.max(2, Math.ceil(minRunway / groupWidth));
      const currentCopies = track.querySelectorAll('.school-marquee-group').length;

      for (let i = currentCopies; i < copiesNeeded; i++) {
        const clone = firstGroup.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        track.appendChild(clone);
      }

      const totalCopies = track.querySelectorAll('.school-marquee-group').length;
      const shiftPercent = (100 / totalCopies).toFixed(4);
      track.style.setProperty('--shift-pct', '-' + shiftPercent + '%');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndEnsureRunway);
  } else {
    checkAndEnsureRunway();
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(checkAndEnsureRunway, 200);
  });
})();

(function() {
  'use strict';

  /* ============================================================
     1. CONFIGURATION LAYER (Configurable placeholders)
     ============================================================ */
  const MMC_LEAD_CONFIG = {
    // Configurable endpoint for Prompt 2 (leave empty until backend is ready):
    LEAD_API_ENDPOINT: "/api/leads", 
    // Approved privacy policy URL placeholder (replace before live launch):
    PRIVACY_POLICY_URL: "[PRIVACY_POLICY_URL_PLACEHOLDER]",
    CONSENT_VERSION: "v1.0-2027",
    SPLASH_DELAY_MS: 10000,
    // Enable test mode via URL parameter (?lead_test_mode=1) or flag for local testing:
    IS_TEST_MODE: (new URLSearchParams(window.location.search)).get('lead_test_mode') === '1'
  };

  /* ============================================================
     2. ATTRIBUTION & TRACKING PREPARATION
     ============================================================ */
  function getAttributionData() {
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
      utm_content: params.get('utm_content') || null,
      utm_term: params.get('utm_term') || null,
      fbclid: params.get('fbclid') || null,
      landing_page_url: window.location.href,
      referrer_url: document.referrer || null
    };
  }

  /* ============================================================
     3. SHARED IN-MEMORY DATA STORE (Zero Data Loss Across Instances)
     ============================================================ */
  const leadStore = {
    values: {
      full_name: '',
      phone: '',
      email: '',
      school_role: '',
      school_role_other: '',
      school_name: '',
      school_city_district: '',
      consent: false
    },
    hasInteracted: false,
    isSubmitting: false,
    isSubmitted: false
  };

  const forms = Array.from(document.querySelectorAll('.mmc-lead-form'));
  const heroBox = document.getElementById('heroLeadBox');
  const heroTeaser = document.getElementById('heroLeadTeaser');
  const heroExpanded = document.getElementById('heroLeadExpanded');
  const heroCollapseBtn = document.getElementById('heroLeadCollapseBtn');

  const modalBackdrop = document.getElementById('leadModalBackdrop');
  const modalDialog = document.getElementById('leadModalDialog');
  const modalCloseBtn = document.getElementById('leadModalCloseBtn');

  const floatingPrompt = document.getElementById('floatingLeadPrompt');
  const floatingBtn = document.getElementById('floatingLeadBtn');
  const floatingDismiss = document.getElementById('floatingLeadDismiss');

  let activeOpenerElement = null;

  /* ============================================================
     4. FIELD VALIDATION RULES
     ============================================================ */
  function validatePhone(phoneStr) {
    if (!phoneStr) return false;
    const cleaned = phoneStr.trim().replace(/[\s\-]/g, '');
    // Accepts 10-digit Indian numbers starting with 6-9, optionally prefixed by +91, 91, or 0:
    return /^(\+91|91|0)?[6-9]\d{9}$/.test(cleaned);
  }

  function validateEmail(emailStr) {
    if (!emailStr || emailStr.trim() === '') return true; // Optional field
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailStr.trim());
  }

  function validateForm(values) {
    const errors = {};

    // 1. Full Name
    if (!values.full_name || values.full_name.trim().length < 2) {
      errors.full_name = "Please enter your full name.";
    }

    // 2. Working phone number
    if (!values.phone || !validatePhone(values.phone)) {
      errors.phone = "Please enter a valid working phone number (10-digit mobile or +91 format).";
    }

    // 3. Working E-mail (Optional, but validated if provided)
    if (!validateEmail(values.email)) {
      errors.email = "Please enter a valid email address, or leave it blank.";
    }

    // 4. Role in School
    if (!values.school_role) {
      errors.school_role = "Please select your role in the school.";
    } else if (values.school_role === 'Other') {
      if (!values.school_role_other || values.school_role_other.trim().length < 2) {
        errors.school_role_other = "Please specify your role in the school.";
      }
    }

    // 5. School Name
    if (!values.school_name || values.school_name.trim().length < 3) {
      errors.school_name = "Please enter your school name.";
    }

    // 6. City / District
    if (!values.school_city_district || values.school_city_district.trim().length < 2) {
      errors.school_city_district = "Please enter the city or district where your school is located.";
    }

    // 7. Consent Checkbox
    if (!values.consent) {
      errors.consent = "Please check the consent box to proceed with your school enquiry.";
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors: errors
    };
  }

  /* ============================================================
     5. BI-DIRECTIONAL STATE SYNCHRONIZATION
     ============================================================ */
  function syncStateToAllForms(triggerForm) {
    forms.forEach(form => {
      if (form === triggerForm) return; // already has the current value

      const nameInput = form.querySelector('[name="full_name"]');
      const phoneInput = form.querySelector('[name="phone"]');
      const emailInput = form.querySelector('[name="email"]');
      const roleSelect = form.querySelector('[name="school_role"]');
      const roleOtherInput = form.querySelector('[name="school_role_other"]');
      const schoolInput = form.querySelector('[name="school_name"]');
      const cityInput = form.querySelector('[name="school_city_district"]');
      const consentInput = form.querySelector('[name="consent"]');

      if (nameInput && nameInput.value !== leadStore.values.full_name) nameInput.value = leadStore.values.full_name;
      if (phoneInput && phoneInput.value !== leadStore.values.phone) phoneInput.value = leadStore.values.phone;
      if (emailInput && emailInput.value !== leadStore.values.email) emailInput.value = leadStore.values.email;
      if (roleSelect && roleSelect.value !== leadStore.values.school_role) roleSelect.value = leadStore.values.school_role;
      if (roleOtherInput && roleOtherInput.value !== leadStore.values.school_role_other) roleOtherInput.value = leadStore.values.school_role_other;
      if (schoolInput && schoolInput.value !== leadStore.values.school_name) schoolInput.value = leadStore.values.school_name;
      if (cityInput && cityInput.value !== leadStore.values.school_city_district) cityInput.value = leadStore.values.school_city_district;
      if (consentInput && consentInput.checked !== leadStore.values.consent) consentInput.checked = leadStore.values.consent;

      // Sync "Other" role field visibility
      const otherGroup = form.querySelector('.form-group-other');
      if (otherGroup) {
        otherGroup.style.display = leadStore.values.school_role === 'Other' ? 'flex' : 'none';
        const otherInp = otherGroup.querySelector('input');
        if (otherInp) otherInp.required = leadStore.values.school_role === 'Other';
      }
    });
  }

  function displayFormErrors(form, errors) {
    // Clear all existing error states on this form
    form.querySelectorAll('.form-group').forEach(group => {
      group.classList.remove('has-error');
      const errEl = group.querySelector('.field-error');
      if (errEl) errEl.textContent = '';
      const input = group.querySelector('input, select');
      if (input) input.removeAttribute('aria-invalid');
    });

    let firstErrorField = null;

    Object.keys(errors).forEach(fieldName => {
      const group = form.querySelector(`[data-field="${fieldName}"]`);
      if (group) {
        group.classList.add('has-error');
        const errEl = group.querySelector('.field-error');
        if (errEl) {
          errEl.textContent = errors[fieldName];
        }
        const input = group.querySelector('input, select');
        if (input) {
          input.setAttribute('aria-invalid', 'true');
          if (!firstErrorField) firstErrorField = input;
        }
      }
    });

    if (firstErrorField) {
      firstErrorField.focus();
    }
  }

  function clearFormError(form, fieldName) {
    const group = form.querySelector(`[data-field="${fieldName}"]`);
    if (group) {
      group.classList.remove('has-error');
      const errEl = group.querySelector('.field-error');
      if (errEl) errEl.textContent = '';
      const input = group.querySelector('input, select');
      if (input) input.removeAttribute('aria-invalid');
    }
  }

  /* ============================================================
     6. FORM INPUT EVENT LISTENERS
     ============================================================ */
  forms.forEach(form => {
    form.addEventListener('input', (e) => {
      leadStore.hasInteracted = true;
      const target = e.target;
      const name = target.name;
      if (!name) return;

      if (target.type === 'checkbox') {
        leadStore.values[name] = target.checked;
      } else {
        leadStore.values[name] = target.value;
      }

      clearFormError(form, name);
      syncStateToAllForms(form);
    });

    form.addEventListener('change', (e) => {
      leadStore.hasInteracted = true;
      const target = e.target;
      const name = target.name;
      if (!name) return;

      if (name === 'school_role') {
        leadStore.values.school_role = target.value;
        const otherGroup = form.querySelector('.form-group-other');
        if (otherGroup) {
          otherGroup.style.display = target.value === 'Other' ? 'flex' : 'none';
          const otherInp = otherGroup.querySelector('input');
          if (otherInp) otherInp.required = target.value === 'Other';
        }
      } else if (target.type === 'checkbox') {
        leadStore.values[name] = target.checked;
      }

      clearFormError(form, name);
      syncStateToAllForms(form);
    });

    // Form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (leadStore.isSubmitting) return;

      const validation = validateForm(leadStore.values);
      if (!validation.isValid) {
        displayFormErrors(form, validation.errors);
        return;
      }

      // Prepare Canonical Lead Payload
      const attribution = getAttributionData();
      const canonicalPayload = {
        full_name: leadStore.values.full_name.trim(),
        phone: leadStore.values.phone.trim(),
        email: leadStore.values.email && leadStore.values.email.trim() ? leadStore.values.email.trim() : null,
        school_role: leadStore.values.school_role,
        school_role_other: leadStore.values.school_role === 'Other' ? (leadStore.values.school_role_other || '').trim() : null,
        school_name: leadStore.values.school_name.trim(),
        school_city_district: leadStore.values.school_city_district.trim(),
        consent: Boolean(leadStore.values.consent),
        consent_version: MMC_LEAD_CONFIG.CONSENT_VERSION,
        submitted_at: new Date().toISOString(),
        landing_page_url: attribution.landing_page_url,
        referrer_url: attribution.referrer_url,
        utm_source: attribution.utm_source,
        utm_medium: attribution.utm_medium,
        utm_campaign: attribution.utm_campaign,
        utm_content: attribution.utm_content,
        utm_term: attribution.utm_term,
        fbclid: attribution.fbclid
      };

      const submitBtn = form.querySelector('.form-submit-btn');
      const btnText = submitBtn.querySelector('.btn-text');
      const spinner = submitBtn.querySelector('.btn-spinner');
      const icon = submitBtn.querySelector('.btn-icon');
      const statusBanner = form.querySelector('.form-status-banner');

      // Check if Backend Endpoint is configured
      if (!MMC_LEAD_CONFIG.LEAD_API_ENDPOINT && !MMC_LEAD_CONFIG.IS_TEST_MODE) {
        // Truthful, non-pretending response: show clear notice and preserve form data
        if (statusBanner) {
          statusBanner.className = 'form-status-banner is-notice';
          statusBanner.style.display = 'block';
          statusBanner.innerHTML = '<strong>Configuration Notice:</strong> The submission backend endpoint is awaiting configuration (<code>LEAD_API_ENDPOINT</code> is not set). Your entered school details are safely preserved in this session. Submissions will be transmitted once the backend integration is configured in Prompt 2.';
        }
        return;
      }

      // Execute Submission
      leadStore.isSubmitting = true;
      submitBtn.disabled = true;
      if (spinner) spinner.style.display = 'inline-block';
      if (icon) icon.style.display = 'none';
      if (btnText) btnText.textContent = 'Submitting Details...';
      if (statusBanner) statusBanner.style.display = 'none';

      try {
        if (MMC_LEAD_CONFIG.IS_TEST_MODE) {
          // Simulated test roundtrip for development verification
          await new Promise(r => setTimeout(r, 700));
          handleSuccess(form, canonicalPayload, true);
        } else {
          const res = await fetch(MMC_LEAD_CONFIG.LEAD_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(canonicalPayload)
          });
          if (res.ok) {
            handleSuccess(form, canonicalPayload, false);
          } else {
            throw new Error('Server returned ' + res.status);
          }
        }
      } catch (err) {
        if (statusBanner) {
          statusBanner.className = 'form-status-banner is-error';
          statusBanner.style.display = 'block';
          statusBanner.textContent = 'Unable to complete submission right now. Your details are preserved. Please retry or contact the MMC team directly.';
        }
      } finally {
        leadStore.isSubmitting = false;
        submitBtn.disabled = false;
        if (spinner) spinner.style.display = 'none';
        if (icon) icon.style.display = 'inline-block';
        if (btnText) btnText.textContent = 'Submit School Details';
      }
    });
  });

  function handleSuccess(form, payload, isTest) {
    leadStore.isSubmitted = true;
    const statusBanner = form.querySelector('.form-status-banner');
    if (statusBanner) {
      statusBanner.className = 'form-status-banner is-success';
      statusBanner.style.display = 'block';
      statusBanner.innerHTML = isTest
        ? '<strong>[TEST MODE SUCCESS]</strong> School details validated and structured for submission.<br><small style="opacity:0.85">Payload ready for Prompt 2 backend integration.</small>'
        : '<strong>Thank you!</strong> Your school details have been received. An MMC programme advisor will reach out to schedule an introductory discussion.';
    }
    const submitBtn = form.querySelector('.form-submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      const btnText = submitBtn.querySelector('.btn-text');
      if (btnText) btnText.textContent = 'Details Submitted';
    }
  }

  /* ============================================================
     7. ENTRY POINT 1: HERO COMPACT CARD EXPAND / COLLAPSE
     ============================================================ */
  function toggleHeroLead(forceExpand) {
    if (!heroBox || !heroTeaser || !heroExpanded) return;
    const willExpand = forceExpand !== undefined ? forceExpand : !heroBox.classList.contains('is-expanded');

    if (willExpand) {
      heroBox.classList.add('is-expanded');
      heroTeaser.setAttribute('aria-expanded', 'true');
      heroExpanded.setAttribute('aria-hidden', 'false');
      leadStore.hasInteracted = true;
      // Focus first input
      setTimeout(() => {
        const firstInp = heroExpanded.querySelector('input');
        if (firstInp) firstInp.focus();
      }, 350);
    } else {
      heroBox.classList.remove('is-expanded');
      heroTeaser.setAttribute('aria-expanded', 'false');
      heroExpanded.setAttribute('aria-hidden', 'true');
      heroTeaser.focus();
    }
  }

  if (heroTeaser) {
    heroTeaser.addEventListener('click', () => toggleHeroLead());
    heroTeaser.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleHeroLead();
      }
    });
  }
  if (heroCollapseBtn) {
    heroCollapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHeroLead(false);
    });
  }

  /* ============================================================
     8. ENTRY POINT 2: MODAL CONTROLLER (10-SEC SPLASH & TRIGGERED)
     ============================================================ */
  function openLeadModal(sourceElementOrTrigger) {
    if (!modalBackdrop || !modalDialog) return;
    if (modalBackdrop.classList.contains('is-active')) return;

    activeOpenerElement = (sourceElementOrTrigger && typeof sourceElementOrTrigger.focus === 'function')
      ? sourceElementOrTrigger
      : document.activeElement;

    // Synchronize latest in-memory state before opening
    syncStateToAllForms(null);

    modalBackdrop.classList.add('is-active');
    modalBackdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lead-modal-open');

    // Hide floating prompt while modal is active to avoid visual clash
    if (floatingPrompt) floatingPrompt.classList.add('is-hidden');

    // Accessibility focus management
    setTimeout(() => {
      const firstInp = modalDialog.querySelector('input:not([type="checkbox"])');
      if (firstInp) firstInp.focus();
      else modalCloseBtn.focus();
    }, 200);
  }

  function closeLeadModal(isExplicitDismissal) {
    if (!modalBackdrop || !modalDialog) return;
    if (!modalBackdrop.classList.contains('is-active')) return;

    modalBackdrop.classList.remove('is-active');
    modalBackdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lead-modal-open');

    // Restore floating prompt if not dismissed
    if (floatingPrompt && sessionStorage.getItem('mmc_floating_dismissed') !== '1') {
      floatingPrompt.classList.remove('is-hidden');
    }

    if (isExplicitDismissal) {
      sessionStorage.setItem('mmc_splash_dismissed', '1');
    }

    if (activeOpenerElement && typeof activeOpenerElement.focus === 'function') {
      activeOpenerElement.focus();
    }
  }

  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', () => closeLeadModal(true));
  }
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        closeLeadModal(true);
      }
    });
  }

  // Keyboard navigation for Modal (Escape & Tab Trap)
  document.addEventListener('keydown', (e) => {
    if (!modalBackdrop || !modalBackdrop.classList.contains('is-active')) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeLeadModal(true);
      return;
    }

    if (e.key === 'Tab') {
      const focusables = Array.from(modalDialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'
      ));
      if (focusables.length === 0) return;

      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
  });

  /* 10-Second Automatic Splash Trigger */
  const hasSplashBeenHandled = sessionStorage.getItem('mmc_splash_dismissed') === '1' || sessionStorage.getItem('mmc_splash_shown') === '1';

  if (!hasSplashBeenHandled) {
    setTimeout(() => {
      // Do not open if user has interacted with any form, or hero form is open, or modal is already active
      if (leadStore.hasInteracted) return;
      if (heroBox && heroBox.classList.contains('is-expanded')) return;
      if (modalBackdrop && modalBackdrop.classList.contains('is-active')) return;
      if (document.body.classList.contains('video-modal-open')) return;

      sessionStorage.setItem('mmc_splash_shown', '1');
      openLeadModal(null);
    }, MMC_LEAD_CONFIG.SPLASH_DELAY_MS);
  }

  /* ============================================================
     9. ENTRY POINT 3: BOTTOM-RIGHT FLOATING PROMPT
     ============================================================ */
  if (floatingBtn) {
    floatingBtn.addEventListener('click', () => {
      leadStore.hasInteracted = true;
      openLeadModal(floatingBtn);
    });
    floatingBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        leadStore.hasInteracted = true;
        openLeadModal(floatingBtn);
      }
    });
  }

  if (floatingDismiss) {
    floatingDismiss.addEventListener('click', (e) => {
      e.stopPropagation();
      sessionStorage.setItem('mmc_floating_dismissed', '1');
      if (floatingPrompt) floatingPrompt.classList.add('is-hidden');
    });
  }

  if (sessionStorage.getItem('mmc_floating_dismissed') === '1' && floatingPrompt) {
    floatingPrompt.classList.add('is-hidden');
  }

  /* ============================================================
     10. GLOBAL CTA HOOKS
     ============================================================ */
  document.querySelectorAll('[data-open-lead-modal]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      leadStore.hasInteracted = true;
      openLeadModal(btn);
    });
  });

})();