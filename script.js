// Hero: scroll-driven, painted-gzhel flowers (real frames the user supplied
// — a 9-step growth→wilt flipbook per flower, crossfaded by scroll — plus
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
  // art) — so each slot can be positioned/scaled once and the 9 frames
  // simply crossfade on top of each other, no per-frame repositioning
  const NATURAL_W = 2700;
  const NATURAL_H = 2048;
  const STEM_FX = { left: 1987 / NATURAL_W, right: 1 - 1987 / NATURAL_W };

  // growth (1-5) → wilt (6-7) → bends over (8-9), as scroll progress
  // breakpoints; frame 5 (full bloom) holds until wilt begins at 0.56,
  // frame 9 (drooping) holds from 0.77 until the whole layer fades 0.8-0.92
  const FRAME_POINTS = [0, 0.05, 0.11, 0.18, 0.26, 0.56, 0.63, 0.7, 0.77];
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
    // anchoring flush to the bottom edge reads as "too low" — lift them
    const mobileLift = w <= 860 ? h * 0.13 : 0;
    const bottomAnchor = h - 6 - mobileLift;

    slots.forEach((s) => {
      const size = SIZE_BY_ROLE[s.role];
      const pxHeight = Math.min(h * size.h, w * size.w);
      const pxWidth = (pxHeight / NATURAL_H) * NATURAL_W;
      const edgeOffset = w * 0.02;
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
  // each frame holds fully opaque for most of its window and only
  // crossfades into the next during a short slice near the breakpoint —
  // reads as a sequence of held poses snapping forward, not one long blur
  const SWAP_FRAC = 0.4;
  function frameOpacity(idx, progress, points) {
    const cur = points[idx];
    const fadeIn =
      idx > 0
        ? smoothstep(cur - (cur - points[idx - 1]) * SWAP_FRAC, cur, progress)
        : 1;
    const fadeOut =
      idx < points.length - 1
        ? 1 - smoothstep(cur, cur + (points[idx + 1] - cur) * SWAP_FRAC, progress)
        : 1;
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
      s.petals.forEach((p, i) => {
        const cfg = PETAL_FALL[i];
        const pLocal = Math.max(0, Math.min(1, (wiltT - cfg.delay) / (1 - cfg.delay)));
        const baseX = cfg.fx * parseFloat(s.el.style.width) - s.petalWidth / 2;
        const baseY = cfg.fy * (parseFloat(s.el.style.width) * (NATURAL_H / NATURAL_W));
        const dxPx = cfg.dx * mirror * parseFloat(s.el.style.width) * pLocal;
        const dyPx = cfg.dy * parseFloat(s.el.style.width) * pLocal;
        const rot = (cfg.rot * mirror) + cfg.spin * pLocal;
        p.style.transform = `translate(${baseX + dxPx}px,${baseY + dyPx}px) rotate(${rot}deg)`;
        const pOpacity = smoothstep(0, 0.15, pLocal) * (1 - smoothstep(0.7, 1, pLocal));
        p.style.opacity = String(pOpacity);
      });
    });

    field.style.opacity = String(1 - smoothstep(0.8, 0.92, progress));

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
      const edgeOffset = w * 0.02;
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
    // screen 2, then hold there while fading — not sinking further down
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
  // stops mid-transition, showing two slides visibly overlapping — a
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

// Solution: petals catch fire, bloom bigger than the hero, one stem per
// scroll segment, each carrying a value-prop label
(function () {
  const wrap = document.querySelector('.solution-wrap');
  const svg = document.querySelector('.solution-svg');
  const head = document.querySelector('.solution-head');
  const labels = Array.from(document.querySelectorAll('.sol-label'));
  const mobileLabel = document.querySelector('.sol-label-mobile');
  const mobileLabelParts = mobileLabel
    ? { b: mobileLabel.querySelector('b'), span: mobileLabel.querySelector('span') }
    : null;
  // mobile has no room for 8 side-by-side labels (they overlap at any
  // viewport under ~500px), so a single bottom slot swaps its text as the
  // active stem changes instead
  const labelText = labels.map((l) => ({
    title: l.querySelector('b').textContent,
    body: l.querySelector('span').textContent,
  }));
  let lastMobileIndex = -1;
  if (!wrap || !svg) return;

  const stemEls = Array.from(svg.querySelectorAll('.sol-stem'));
  const n = stemEls.length;

  function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function lerpColor(hexA, hexB, t) {
    const a = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
    const b = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  // getBBox() on a <defs> path that is never rendered ignores its
  // ancestor transform and returns raw pre-scale potrace coordinates, not
  // the viewBox-matched size — so the natural size is given explicitly
  // here (same numbers used when the motifs were traced and generated).
  const NATURAL_SIZE = {
    tulip: { w: 402, h: 642 },
    leaf: { w: 366, h: 660 },
    swirl: { w: 384, h: 642 },
  };

  const stems = stemEls.map((g) => {
    const bloom = g.querySelector('.sol-bloom');
    const use = g.querySelector('.sol-draw');
    const refId = use.getAttribute('href').slice(1);
    const refPath = document.querySelector(`#${refId} path`);
    const len = refPath.getTotalLength();
    const size = NATURAL_SIZE[g.dataset.shape];
    return {
      g,
      bloom,
      use,
      len,
      x: parseFloat(g.dataset.x),
      mirror: g.dataset.mirror === '1',
      naturalW: size.w,
      naturalH: size.h,
    };
  });

  function layout() {
    const w = wrap.querySelector('.solution-stage').clientWidth;
    const h = wrap.querySelector('.solution-stage').clientHeight;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    stems.forEach((s) => {
      const pxHeight = Math.min(h * 0.46, w * 0.22);
      const scale = pxHeight / s.naturalH;
      const cx = (s.x / 100) * w;
      const bottomAnchor = h - 4;
      const ty = bottomAnchor - pxHeight;
      const tx = cx - (s.naturalW * scale) / 2;
      const sx = s.mirror ? -scale : scale;
      const txAdj = s.mirror ? cx + (s.naturalW * scale) / 2 : tx;
      s.g.setAttribute('transform', `translate(${txAdj},${ty}) scale(${sx},${scale})`);
    });
  }
  layout();

  let ticking = false;
  function update() {
    ticking = false;
    const scrollable = wrap.offsetHeight - window.innerHeight;
    const scrolled = -wrap.getBoundingClientRect().top;
    const progress = scrollable > 0 ? Math.min(1, Math.max(0, scrolled / scrollable)) : 0;

    const isMobile = window.innerWidth <= 860;

    if (head) {
      const tIn = smoothstep(0, 0.07, progress);
      const tOut = isMobile ? smoothstep(0.09, 0.16, progress) : 0;
      const t = tIn * (1 - tOut);
      head.style.opacity = String(t);
      head.style.transform = `translateY(${(1 - tIn) * 14 - tOut * 10}px)`;
    }

    const bodyStart = 0.1;
    const segment = (1 - bodyStart) / n;

    if (mobileLabel) {
      const activeIndex = Math.min(n - 1, Math.max(0, Math.floor((progress - bodyStart) / segment)));
      if (progress >= bodyStart) {
        if (activeIndex !== lastMobileIndex && labelText[activeIndex]) {
          mobileLabelParts.b.textContent = labelText[activeIndex].title;
          mobileLabelParts.span.textContent = labelText[activeIndex].body;
          lastMobileIndex = activeIndex;
        }
        const segLocal = smoothstep(
          bodyStart + activeIndex * segment,
          bodyStart + activeIndex * segment + segment,
          progress
        );
        mobileLabel.style.opacity = String(smoothstep(0.15, 0.4, segLocal));
      } else {
        mobileLabel.style.opacity = '0';
        lastMobileIndex = -1;
      }
    }

    stems.forEach((s, i) => {
      const start = bodyStart + i * segment;
      const end = start + segment;
      const local = smoothstep(start, end, progress);

      // draw the outline (unfired, dark)
      const drawT = smoothstep(0, 0.4, local);
      s.use.style.strokeDasharray = String(s.len);
      s.use.style.strokeDashoffset = String(s.len * (1 - drawT));

      // fire: dark -> amber glow -> vivid cobalt, with a small bloom overshoot
      const fireT = smoothstep(0.35, 0.65, local);
      const settleT = smoothstep(0.55, 0.9, local);
      let color;
      if (fireT < 1) {
        color = lerpColor('#1B2A4A', '#D8A657', fireT);
      } else {
        color = lerpColor('#D8A657', '#1D4BA8', settleT);
      }
      s.use.style.fill = color;
      s.use.style.stroke = color;
      s.use.style.fillOpacity = String(smoothstep(0.3, 0.6, local));

      // scale from the stem's own base (bottom-center), so it grows
      // upward/outward rather than jumping away from its planted spot
      const bloomT =
        0.92 + smoothstep(0.6, 0.85, local) * 0.1 - smoothstep(0.85, 1, local) * 0.02;
      const cx = s.naturalW / 2;
      const cy = s.naturalH;
      s.bloom.setAttribute(
        'transform',
        `translate(${cx * (1 - bloomT)},${cy * (1 - bloomT)}) scale(${bloomT})`
      );

      const label = labels[i];
      if (label) {
        const lt = smoothstep(0.78, 1, local);
        label.style.opacity = String(lt);
        label.style.transform = `translate(-50%, ${(1 - lt) * 10}px)`;
      }
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
      if (note) note.textContent = 'Opening your email client to send this — we reply within a few days.';
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

// Team: verification widget — confirms a handle/email against known team contacts
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
        <div><div class="vc-name">${found.name}</div><div class="vc-handle">${found.role} &mdash; verified Vanneck contact</div></div>
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
