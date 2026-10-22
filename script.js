// Hero: scroll-driven, painted-gzhel flowers (real frames the user supplied
// - a 9-step growth→wilt flipbook per flower, crossfaded by scroll - plus
// real cut petal images that detach and fall during the wilt window).
(function () {
  const wrap = document.querySelector('.hero-wrap');
  const field = document.querySelector('.flower-field');
  const text = document.querySelector('.hero-text');
  const scrollHint = document.querySelector('.scroll-hint');
  if (!wrap || !field) return;

  const stage = document.querySelector('.hero-stage');
  const slotEls = Array.from(field.querySelectorAll('.flower-slot'));

  const SIZE_BY_ROLE = {
    main: { h: 0.58, w: 0.62 },
    secondary: { h: 0.3, w: 0.33 },
    tertiary: { h: 0.22, w: 0.24 },
  };
  const CENTER_OFFSET_BY_ROLE = { main: 0, secondary: 0.16, tertiary: 0.3 };

  // every frame shares the same 2700x2048 canvas, with the stem base
  // pinned to the identical pixel in every frame (confirmed on the source
  // art) - so each slot can be positioned/scaled once and the 9 frames
  // simply crossfade on top of each other, no per-frame repositioning
  const NATURAL_W = 2700;
  const NATURAL_H = 2048;
  const STEM_FX = { left: 1987 / NATURAL_W, right: 1 - 1987 / NATURAL_W };

  // growth (1-5) → wilt (6-7) → bends over (8-9), as scroll progress
  // breakpoints; growth is spread wider than before so each crossfade has
  // more scroll distance to blend across and reads as continuous motion
  // rather than a quick snap; frame 5 (full bloom) holds until wilt begins
  // at 0.6, frame 9 (drooping) holds from 0.8 until the layer fades 0.8-0.92
  const FRAME_POINTS = [0, 0.07, 0.16, 0.26, 0.38, 0.6, 0.67, 0.74, 0.8];
  const STAGGER = [0, 0.015, 0.03, 0.045, 0.06, 0.075];

  // falling petals: position/travel as fractions of the slot's own box, so
  // they scale with it; dx mirrors for right-side slots below
  const PETAL_FALL = [
    { fx: 0.4, fy: 0.08, wf: 0.24, rot: -12, dx: -0.22, dy: 0.5, spin: -150, delay: 0.0 },
    { fx: 0.52, fy: 0.03, wf: 0.26, rot: 6, dx: 0.04, dy: 0.56, spin: 170, delay: 0.08 },
    { fx: 0.64, fy: 0.1, wf: 0.23, rot: 18, dx: 0.26, dy: 0.5, spin: -130, delay: 0.14 },
    { fx: 0.48, fy: 0.16, wf: 0.2, rot: -28, dx: -0.08, dy: 0.44, spin: 190, delay: 0.2 },
  ];

  const slots = slotEls.map((el, i) => ({
    el,
    corner: el.dataset.corner,
    role: el.dataset.role,
    frames: Array.from(el.querySelectorAll('.f-frame')),
    petals: Array.from(el.querySelectorAll('.f-petal')),
    stagger: STAGGER[i] || 0,
  }));

  function layout() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    // on narrow viewports the flowers scale down a lot (width-limited), so
    // anchoring flush to the bottom edge reads as "too low" - lift them
    const mobileLift = w <= 860 ? h * 0.13 : 0;
    const bottomAnchor = h - 6 - mobileLift;

    slots.forEach((s) => {
      const size = SIZE_BY_ROLE[s.role];
      const pxHeight = Math.min(h * size.h, w * size.w);
      const pxWidth = (pxHeight / NATURAL_H) * NATURAL_W;
      // scales with the flower's own rendered width, so bigger flowers
      // (bumped up this round) keep their head clear of the viewport edge
      // instead of being sliced in half by it
      const edgeOffset = Math.max(w * 0.015, pxWidth * 0.17);
      const centerOffset = w * CENTER_OFFSET_BY_ROLE[s.role];
      const stemFx = STEM_FX[s.corner];
      const targetX =
        s.corner === 'left' ? edgeOffset + centerOffset : w - edgeOffset - centerOffset;
      const left = targetX - stemFx * pxWidth;
      const top = bottomAnchor - pxHeight;

      s.el.style.width = `${pxWidth}px`;
      s.el.style.left = `${left}px`;
      s.el.style.top = `${top}px`;
      s.petalWidth = pxWidth * 0.22;
      s.petals.forEach((p) => {
        p.style.width = `${s.petalWidth}px`;
      });
    });
  }
  layout();

  function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function frameOpacity(idx, progress, points) {
    const cur = points[idx];
    const fadeIn = idx > 0 ? smoothstep(points[idx - 1], cur, progress) : 1;
    const fadeOut =
      idx < points.length - 1 ? 1 - smoothstep(cur, points[idx + 1], progress) : 1;
    return Math.min(fadeIn, fadeOut);
  }

  let ticking = false;
  function update() {
    ticking = false;
    const scrollable = wrap.offsetHeight - window.innerHeight;
    const scrolled = -wrap.getBoundingClientRect().top;
    const progress = scrollable > 0 ? Math.min(1, Math.max(0, scrolled / scrollable)) : 1;

    slots.forEach((s) => {
      const points = FRAME_POINTS.map((p) => Math.min(0.97, p + s.stagger));
      s.frames.forEach((frame, i) => {
        frame.style.opacity = String(frameOpacity(i, progress, points));
      });

      // petals shed during the same wilt window as frames 6-9
      const wiltT = smoothstep(points[4], points[8], progress);
      const mirror = s.corner === 'right' ? -1 : 1;
      const slotLeft = parseFloat(s.el.style.left);
      const stageW = stage.clientWidth;
      const edgeMargin = 10;
      s.petals.forEach((p, i) => {
        const cfg = PETAL_FALL[i];
        const pLocal = Math.max(0, Math.min(1, (wiltT - cfg.delay) / (1 - cfg.delay)));
        const baseX = cfg.fx * parseFloat(s.el.style.width) - s.petalWidth / 2;
        const baseY = cfg.fy * (parseFloat(s.el.style.width) * (NATURAL_H / NATURAL_W));
        const dxPx = cfg.dx * mirror * parseFloat(s.el.style.width) * pLocal;
        const dyPx = cfg.dy * parseFloat(s.el.style.width) * pLocal;
        // clamp the petal's final ABSOLUTE position (not just local offset) to
        // the viewport, so a petal flying outward during wilt never crosses
        // the screen edge regardless of how far dx/dy would otherwise push it
        const absX = slotLeft + baseX + dxPx;
        const clampedAbsX = Math.min(
          Math.max(absX, edgeMargin),
          stageW - edgeMargin - s.petalWidth
        );
        const clampedX = clampedAbsX - slotLeft;
        const rot = (cfg.rot * mirror) + cfg.spin * pLocal;
        p.style.transform = `translate(${clampedX}px,${baseY + dyPx}px) rotate(${rot}deg)`;
        const pOpacity = smoothstep(0, 0.15, pLocal) * (1 - smoothstep(0.7, 1, pLocal));
        p.style.opacity = String(pOpacity);
      });
    });

    // nothing shows on first paint (just the scroll hint) - the stems fade
    // in over the first sliver of scroll instead of being visible at rest
    field.style.opacity = String(
      smoothstep(0, 0.025, progress) * (1 - smoothstep(0.8, 0.92, progress))
    );

    if (text) {
      const tIn = smoothstep(0.3, 0.4, progress);
      const tOut = smoothstep(0.56, 0.64, progress);
      const t = tIn * (1 - tOut);
      text.style.opacity = String(t);
      text.style.transform = `translateY(${(1 - tIn) * 18 - tOut * 14}px)`;
    }
    if (scrollHint) {
      scrollHint.style.opacity = String(1 - smoothstep(0.01, 0.05, progress));
    }
  }
  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    layout();
    onScroll();
  });
  update();
})();

// Hero bud: a big centered flower the visitor can grab and tilt in 3D
// (drag = rotateX/rotateY on the image). Rotate or shake it hard enough and
// petals fly off, reusing the same painted petal cutouts as the wilt effect.
(function () {
  const bud = document.getElementById('heroBud');
  const img = bud ? bud.querySelector('.hero-bud-img') : null;
  const petalLayer = document.getElementById('heroBudPetals');
  if (!bud || !img || !petalLayer) return;

  const PETAL_SRCS = [
    'assets/img/flowers/rose_petal1.webp',
    'assets/img/flowers/rose_petal2.webp',
    'assets/img/flowers/rose_petal3.webp',
    'assets/img/flowers/rose_petal4.webp',
  ];

  let rotX = 0;
  let rotY = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let speed = 0; // smoothed drag speed, drives the shake-to-shed trigger
  let shedCooldown = 0;

  function applyRotation() {
    const cx = Math.max(-28, Math.min(28, rotX));
    const cy = Math.max(-40, Math.min(40, rotY));
    img.style.transform = `rotateX(${cx}deg) rotateY(${cy}deg)`;
  }
  applyRotation();

  function shedPetal() {
    const src = PETAL_SRCS[Math.floor(Math.random() * PETAL_SRCS.length)];
    const el = document.createElement('img');
    el.className = 'hero-bud-petal';
    el.src = src;
    el.alt = '';
    const angle = Math.random() * Math.PI * 2;
    const dist = 140 + Math.random() * 160;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist * 0.6 - 40; // mostly outward, slight lift
    const spin = (Math.random() - 0.5) * 540;
    const startX = (Math.random() - 0.5) * 60;
    petalLayer.appendChild(el);

    let start = null;
    const DURATION = 950;
    function frame(t) {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / DURATION);
      const ease = 1 - Math.pow(1 - p, 2);
      const fall = p * p * 90;
      el.style.transform = `translate(${startX + dx * ease}px,${dy * ease + fall}px) rotate(${spin * p}deg)`;
      el.style.opacity = String(p < 0.12 ? p / 0.12 : 1 - Math.pow((p - 0.12) / 0.88, 1.4));
      if (p < 1) {
        requestAnimationFrame(frame);
      } else {
        el.remove();
      }
    }
    requestAnimationFrame(frame);
  }

  function pointerDown(e) {
    dragging = true;
    bud.setPointerCapture(e.pointerId);
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = performance.now();
    speed = 0;
  }
  function pointerMove(e) {
    if (!dragging) return;
    const now = performance.now();
    const dt = Math.max(16, now - lastT);
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    rotY += dx * 0.45;
    rotX -= dy * 0.45;
    applyRotation();

    const instSpeed = Math.sqrt(dx * dx + dy * dy) / dt; // px/ms
    speed = speed * 0.7 + instSpeed * 0.3;

    if (speed > 1.6 && shedCooldown <= 0) {
      shedPetal();
      shedCooldown = 4; // throttle so a sustained shake sheds a steady trickle
    }

    lastX = e.clientX;
    lastY = e.clientY;
    lastT = now;
  }
  function pointerUp(e) {
    dragging = false;
    try { bud.releasePointerCapture(e.pointerId); } catch (err) {}
  }
  function decay() {
    if (shedCooldown > 0) shedCooldown -= 1;
    if (!dragging) {
      // ease back toward a gentle resting tilt instead of a hard snap
      rotX += (0 - rotX) * 0.06;
      rotY += (0 - rotY) * 0.06;
      applyRotation();
    }
    requestAnimationFrame(decay);
  }
  requestAnimationFrame(decay);

  bud.addEventListener('pointerdown', pointerDown);
  bud.addEventListener('pointermove', pointerMove);
  bud.addEventListener('pointerup', pointerUp);
  bud.addEventListener('pointercancel', pointerUp);
})();

// Fallen petals: fixed overlay that carries the drooping flowers from the
// end of the hero across the seam into the top of the Problem section,
// always above both sections' own backgrounds, continuing to sink.
(function () {
  const heroWrap = document.querySelector('.hero-wrap');
  const problemWrap = document.querySelector('.problem-wrap');
  const overlay = document.querySelector('.fallen-overlay');
  if (!heroWrap || !problemWrap || !overlay) return;

  const motifs = Array.from(overlay.querySelectorAll('.fallen-motif'));

  const SIZE_BY_ROLE = {
    main: { h: 0.58, w: 0.62 },
    secondary: { h: 0.3, w: 0.33 },
    tertiary: { h: 0.22, w: 0.24 },
  };
  const CENTER_OFFSET_BY_ROLE = { main: 0, secondary: 0.16, tertiary: 0.3 };
  const NATURAL_W = 2700;
  const NATURAL_H = 2048;
  const STEM_FX = { left: 1987 / NATURAL_W, right: 1 - 1987 / NATURAL_W };

  let bounds = []; // base placement per motif, computed on layout()
  let fallStart = 0;
  let fallEnd = 1;

  function layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    bounds = motifs.map((el) => {
      const corner = el.dataset.corner;
      const role = el.dataset.role;
      const size = SIZE_BY_ROLE[role];
      const pxHeight = Math.min(h * size.h, w * size.w);
      const pxWidth = (pxHeight / NATURAL_H) * NATURAL_W;
      const edgeOffset = Math.max(w * 0.015, pxWidth * 0.17);
      const centerOffset = w * CENTER_OFFSET_BY_ROLE[role];
      const stemFx = STEM_FX[corner];
      const targetX = corner === 'left' ? edgeOffset + centerOffset : w - edgeOffset - centerOffset;
      const left = targetX - stemFx * pxWidth;
      const bottomAnchor = h - 6;
      const top = bottomAnchor - pxHeight; // hand-off position, matches the hero's own anchor
      const topMiddle = (h - pxHeight) / 2; // where it settles on screen 2: vertical middle, not the bottom
      return { el, left, width: pxWidth, top, topMiddle };
    });

    const heroRect = heroWrap.getBoundingClientRect();
    const heroTop = heroRect.top + window.scrollY;
    const heroScrollable = heroWrap.offsetHeight - window.innerHeight;
    fallStart = heroTop + 0.8 * heroScrollable;

    const problemRect = problemWrap.getBoundingClientRect();
    const problemTop = problemRect.top + window.scrollY;
    const problemScrollable = problemWrap.offsetHeight - window.innerHeight;
    fallEnd = problemTop + 0.22 * problemScrollable;
  }

  function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  layout();

  let ticking = false;
  function update() {
    ticking = false;
    const span = fallEnd - fallStart;
    const fall = span > 0 ? Math.min(1, Math.max(0, (window.scrollY - fallStart) / span)) : 0;

    const fadeIn = smoothstep(0, 0.1, fall);
    const fadeOut = smoothstep(0.6, 1, fall);
    overlay.style.opacity = String(fadeIn * (1 - fadeOut));

    // rise from the hand-off (bottom) position to the vertical middle of
    // screen 2, then hold there while fading - not sinking further down
    const settleT = smoothstep(0, 0.45, fall);
    bounds.forEach((m) => {
      const top = m.top + (m.topMiddle - m.top) * settleT;
      m.el.style.left = `${m.left}px`;
      m.el.style.top = `${top}px`;
      m.el.style.width = `${m.width}px`;
    });
  }
  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    layout();
    onScroll();
  });
  update();
})();

// Plate: a real dish sits tilted back on a stand; it tilts further
// toward the cursor like a coin being turned over
(function () {
  const wrap = document.querySelector('.plate-3d');
  const plate = document.querySelector('.plate');
  if (!wrap || !plate) return;

  const REST_X = 14;

  function setTilt(rotateX, rotateY) {
    plate.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  }
  setTilt(REST_X, 0);

  wrap.addEventListener('pointermove', (e) => {
    const rect = wrap.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5..0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    const rotateY = x * 34;
    const rotateX = REST_X - y * 22;
    plate.style.transition = 'transform 0.1s linear';
    setTilt(rotateX, rotateY);
  });
  wrap.addEventListener('pointerleave', () => {
    plate.style.transition = 'transform .7s cubic-bezier(.22,1,.36,1)';
    setTilt(REST_X, 0);
  });
})();

// Problem: gzhel plate with scroll-cycled slides
(function () {
  const wrap = document.querySelector('.problem-wrap');
  const slides = Array.from(document.querySelectorAll('.problem-slide'));
  if (!wrap || !slides.length) return;

  const n = slides.length;
  // The swap is driven by a CSS transition (wall-clock time), not by
  // interpolating opacity against scroll position. A scroll-interpolated
  // crossfade can be caught, by a static screenshot or a scroll that
  // stops mid-transition, showing two slides visibly overlapping - a
  // CSS transition always finishes to exactly one slide at opacity 1,
  // however the scroll stops.
  slides.forEach((el) => {
    el.style.transition = 'opacity .35s ease, transform .35s ease';
  });

  let activeIdx = -1;
  let ticking = false;
  function update() {
    ticking = false;
    const scrollable = wrap.offsetHeight - window.innerHeight;
    const scrolled = -wrap.getBoundingClientRect().top;
    const progress = scrollable > 0 ? Math.min(1, Math.max(0, scrolled / scrollable)) : 0;

    const idx = Math.min(n - 1, Math.floor(progress * n));
    if (idx === activeIdx) return;
    activeIdx = idx;
    slides.forEach((el, i) => {
      const active = i === activeIdx;
      el.style.opacity = active ? '1' : '0';
      el.style.transform = active ? 'translateY(0)' : 'translateY(10px)';
    });
  }
  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
})();

// Solution: a gzhel vine winds down the section in normal document flow
// (no sticky pin, so it works the same on phone, tablet and desktop) - the
// stem draws itself in as it scrolls through the viewport, while each
// value-prop block fades in on its own via the shared reveal observer below.
(function () {
  const vineWrap = document.getElementById('vineWrap');
  const svg = vineWrap ? vineWrap.querySelector('.vine-svg') : null;
  const path = svg ? svg.querySelector('.vine-path') : null;
  if (!vineWrap || !svg || !path) return;

  function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  let pathLen = 0;

  function layout() {
    const w = vineWrap.clientWidth;
    const h = vineWrap.scrollHeight;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);

    // a gentle serpentine weaving behind the alternating left/right blocks -
    // purely decorative, so an approximated sine path is enough
    const steps = 160;
    const amp = w * 0.24;
    const cx = w / 2;
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = t * h;
      const x = cx + Math.sin(t * Math.PI * 3.4) * amp;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    }
    path.setAttribute('d', d);
    pathLen = path.getTotalLength();
    path.style.strokeDasharray = String(pathLen);
  }
  layout();

  let ticking = false;
  function update() {
    ticking = false;
    const rect = vineWrap.getBoundingClientRect();
    const vh = window.innerHeight;
    // 0 as the vine's top enters the bottom of the viewport, 1 once its
    // bottom has scrolled up past the top - a plain "reveal while in view"
    // mapping, no sticky pin required
    const progress = smoothstep(vh * 0.85, -rect.height * 0.15, rect.top);
    path.style.strokeDashoffset = String(pathLen * (1 - progress));
  }
  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    layout();
    onScroll();
  });
  update();
})();

// Reveal-on-scroll: shared IntersectionObserver utility. Cards/blocks that
// used to just pop into existence (portfolio, team, services, FAQ, verify,
// the free-diligence block, solution vine text) now fade/rise in once they
// actually enter the viewport, staggered a little within their own grid.
(function () {
  const autoFade = document.querySelectorAll('.port-card, .svc-card');
  const autoRise = document.querySelectorAll('.team-card, .faq-item, .verify-box, .free-stage');
  autoFade.forEach((el) => el.classList.add('reveal-fade'));
  autoRise.forEach((el) => el.classList.add('reveal'));

  const targets = Array.from(document.querySelectorAll('.reveal, .reveal-fade'));
  if (!targets.length) return;

  if (!('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  // small stagger per sibling index so a row of cards cascades in rather
  // than all snapping to visible on the same frame
  const groups = new Map();
  targets.forEach((el) => {
    const parent = el.parentElement;
    const siblingIndex = parent ? Array.from(parent.children).indexOf(el) : 0;
    groups.set(el, Math.min(siblingIndex, 6));
  });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const delay = (groups.get(el) || 0) * 70;
        el.style.transitionDelay = `${delay}ms`;
        el.classList.add('is-visible');
        io.unobserve(el);
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
  );
  targets.forEach((el) => io.observe(el));
})();

// Apply form + newsletter: no backend yet, so both fall back to opening a
// pre-filled mailto: draft and confirm with a short inline note.
(function () {
  const CONTACT_EMAIL = 'hello@vanneckcapital.com';

  function wireMailtoForm(formId, noteId, subjectPrefix, buildBody) {
    const form = document.getElementById(formId);
    const note = document.getElementById(noteId);
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const body = buildBody(data);
      const subject = encodeURIComponent(`${subjectPrefix}: ${data.get('project') || data.get('email') || ''}`);
      window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${encodeURIComponent(body)}`;
      if (note) note.textContent = 'Opening your email client to send this - we reply within a few days.';
      form.reset();
    });
  }

  wireMailtoForm('applyForm', 'applyNote', 'Application', (d) =>
    `Name: ${d.get('name')}\nEmail: ${d.get('email')}\nProject: ${d.get('project')}\nLink: ${d.get('link') || '-'}\n\n${d.get('message') || ''}`
  );

  wireMailtoForm('newsletterForm', 'newsletterNote', 'Newsletter signup', (d) =>
    `Please subscribe: ${d.get('email')}`
  );
})();

// Cookie consent banner
(function () {
  const banner = document.getElementById('cookieBanner');
  if (!banner) return;
  const KEY = 'vanneck-cookie-consent';
  let saved;
  try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
  if (!saved) banner.removeAttribute('hidden');

  document.getElementById('cookieAccept')?.addEventListener('click', () => {
    try { localStorage.setItem(KEY, 'accepted'); } catch (e) {}
    banner.setAttribute('hidden', '');
  });
  document.getElementById('cookieDecline')?.addEventListener('click', () => {
    try { localStorage.setItem(KEY, 'declined'); } catch (e) {}
    banner.setAttribute('hidden', '');
  });
})();

// Custom dropdown: progressively enhances any <select> inside a <label> with
// a branded button + option list, so the open menu isn't the stock OS
// dropdown. The native <select> stays in the DOM (visually hidden) as the
// source of truth - picking an option just sets its value and fires a
// change event, so filter logic elsewhere needs no changes at all.
(function () {
  const selects = Array.from(document.querySelectorAll('.port-filters select'));
  if (!selects.length) return;

  selects.forEach((select) => {
    const wrap = document.createElement('div');
    wrap.className = 'cs-wrap';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cs-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const triggerLabel = document.createElement('span');
    trigger.appendChild(triggerLabel);
    trigger.insertAdjacentHTML(
      'beforeend',
      '<svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );

    const list = document.createElement('ul');
    list.className = 'cs-options';
    list.setAttribute('role', 'listbox');
    list.hidden = true;

    const options = Array.from(select.options);
    const optionEls = options.map((opt) => {
      const li = document.createElement('li');
      li.className = 'cs-option';
      li.setAttribute('role', 'option');
      li.textContent = opt.textContent;
      li.dataset.value = opt.value;
      if (opt.selected) li.classList.add('is-active');
      list.appendChild(li);
      return li;
    });

    function sync() {
      const current = options.find((o) => o.value === select.value) || options[0];
      triggerLabel.textContent = current ? current.textContent : '';
      optionEls.forEach((li) => li.classList.toggle('is-active', li.dataset.value === select.value));
    }
    sync();

    function close() {
      list.hidden = true;
      trigger.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
    }
    function open() {
      document.querySelectorAll('.cs-trigger.is-open').forEach((t) => t !== trigger && t.click());
      list.hidden = false;
      trigger.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
    }

    trigger.addEventListener('click', () => (list.hidden ? open() : close()));
    optionEls.forEach((li) => {
      li.addEventListener('click', () => {
        select.value = li.dataset.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
        close();
      });
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    wrap.appendChild(trigger);
    wrap.appendChild(list);
  });
})();

// Portfolio: blockchain / sector / cohort filters + "show more" paging
(function () {
  const grid = document.getElementById('portfolioGrid');
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll('.port-card'));
  const chainSel = document.getElementById('filterChain');
  const sectorSel = document.getElementById('filterSector');
  const cohortSel = document.getElementById('filterCohort');
  const moreBtn = document.getElementById('portMore');
  const countEl = document.getElementById('portCount');
  const PAGE = 12;
  let shown = PAGE;

  function matches(card) {
    const c = chainSel.value, s = sectorSel.value, co = cohortSel.value;
    if (c && card.dataset.chain !== c) return false;
    if (s && card.dataset.sector !== s) return false;
    if (co && card.dataset.cohort !== co) return false;
    return true;
  }

  function render() {
    const matched = cards.filter(matches);
    cards.forEach((card) => card.classList.add('is-hidden'));
    matched.slice(0, shown).forEach((card) => card.classList.remove('is-hidden'));
    const remaining = matched.length - Math.min(shown, matched.length);
    moreBtn.hidden = remaining <= 0;
    countEl.textContent = matched.length === cards.length
      ? `${cards.length} companies`
      : `${matched.length} of ${cards.length} companies`;
  }

  [chainSel, sectorSel, cohortSel].forEach((sel) => {
    sel.addEventListener('change', () => { shown = PAGE; render(); });
  });
  moreBtn.addEventListener('click', () => { shown += PAGE; render(); });

  render();
})();

// Team: verification widget - confirms a handle/email against known team contacts
(function () {
  const box = document.querySelector('.verify-box');
  if (!box) return;

  const team = [
    { name: 'Trevor Cesur', photo: 'assets/img/team/trevor.jpg', role: 'Co-Founder & Business Development', tg: 't.me/trevhl', x: 'x.com/TrevorCesur', mail: 'trevor@apexfdn.xyz' },
    { name: 'Yong Liu', photo: 'assets/img/team/yong.jpg', role: 'Head of Grants', tg: 't.me/not_a_dev_eth', x: null, mail: null },
    { name: 'Dolphin', photo: 'assets/img/team/dolphin.jpg', role: 'Business Development Manager', tg: 't.me/dlphin01', x: 'x.com/dlphin01', mail: 'dolphin@apexfdn.xyz' },
    { name: 'Chua Joo', photo: 'assets/img/team/chua.jpg', role: 'Investment Relations', tg: 't.me/chuajoo', x: null, mail: 'chua@apexfdn.xyz' },
    { name: 'Nick Buckler', photo: 'assets/img/team/nick.jpg', role: 'Business Developer', tg: 't.me/nickbuckler', x: 'x.com/flokamon6q', mail: null },
    { name: 'Darren Lim', photo: 'assets/img/team/darren.jpg', role: 'Investment Committee', tg: 't.me/liquidlab3', x: 'x.com/darrenvcz0n', mail: 'darrenmgmt@proton.me' },
    { name: 'Edward Lindemann', photo: 'assets/img/team/edwaaard.jpg', role: 'CTO', tg: null, x: 'x.com/edlindex', mail: 'edwardlindemann.ch@gmail.com' },
    { name: 'Son Jin', photo: 'assets/img/team/sonjin.jpg', role: 'Growth Advisor', tg: null, x: 'x.com/SonJin_yop', mail: null },
  ];

  function normalize(v) {
    if (!v) return '';
    return v.trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^t\.me\//, '')
      .replace(/^x\.com\//, '')
      .replace(/^mailto:/, '')
      .replace(/^@/, '');
  }

  let kind = 'tg';
  const tabs = box.querySelectorAll('.verify-tab');
  const input = box.querySelector('#verifyInput');
  const btn = box.querySelector('#verifyBtn');
  const result = box.querySelector('#verifyResult');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      kind = tab.dataset.kind;
      input.placeholder = kind === 'mail' ? 'email address' : '@handle';
      result.innerHTML = '';
    });
  });

  function verify() {
    const q = normalize(input.value);
    if (!q) return;
    const found = team.find((m) => normalize(m[kind]) === q);
    if (found) {
      result.innerHTML = `<div class="verify-card">
        <img src="${found.photo}" alt="${found.name}">
        <div><div class="vc-name">${found.name}</div><div class="vc-handle">${found.role} - verified Vanneck contact</div></div>
      </div>`;
    } else {
      result.innerHTML = `<div class="verify-not-found">No verified Vanneck team member matches &ldquo;${input.value}&rdquo;. Treat this contact as unverified.</div>`;
    }
  }

  btn.addEventListener('click', verify);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') verify(); });
})();

// Mobile nav
const navToggle = document.getElementById('navToggle');
const navSheet = document.getElementById('navSheet');
if (navToggle && navSheet) {
  navToggle.addEventListener('click', () => {
    const open = navSheet.hasAttribute('data-open');
    if (open) {
      navSheet.removeAttribute('data-open');
      navSheet.hidden = true;
    } else {
      navSheet.hidden = false;
      navSheet.setAttribute('data-open', '');
    }
    navToggle.setAttribute('aria-expanded', String(!open));
  });
  navSheet.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    navSheet.removeAttribute('data-open');
    navSheet.hidden = true;
    navToggle.setAttribute('aria-expanded', 'false');
  }));
}
