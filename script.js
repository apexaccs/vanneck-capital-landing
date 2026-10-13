// Hero: scroll-driven gzhel ornament draw
(function () {
  const wrap = document.querySelector('.hero-wrap');
  const svg = document.querySelector('.gzhel-svg');
  const text = document.querySelector('.hero-text');
  if (!wrap || !svg) return;

  const motifs = Array.from(svg.querySelectorAll('.motif'));
  const stage = document.querySelector('.hero-stage');

  const SIZE_BY_ROLE = {
    main: { h: 0.46, w: 0.5 },
    secondary: { h: 0.24, w: 0.26 },
    tertiary: { h: 0.17, w: 0.19 },
  };
  const CENTER_OFFSET_BY_ROLE = { main: 0, secondary: 0.16, tertiary: 0.3 };

  function layout() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    motifs.forEach((g) => {
      const corner = g.dataset.corner; // left | right
      const role = g.dataset.role; // main | secondary | tertiary
      const naturalH = parseFloat(g.dataset.h);
      const size = SIZE_BY_ROLE[role];
      const pxHeight = Math.min(h * size.h, w * size.w);
      const scale = pxHeight / naturalH;
      const bottomAnchor = h - 6;
      const ty = bottomAnchor - pxHeight;
      const edgeOffset = w * 0.02;
      const centerOffset = w * CENTER_OFFSET_BY_ROLE[role];

      let tx, sx;
      if (corner === 'left') {
        tx = -edgeOffset + centerOffset;
        sx = scale;
      } else {
        tx = w + edgeOffset - centerOffset;
        sx = -scale;
      }
      g.setAttribute('transform', `translate(${tx},${ty}) scale(${sx},${scale})`);
    });
  }

  const paths = Array.from(svg.querySelectorAll('.draw-path')).map((el) => {
    // el is a <use>; it has no geometry of its own, so measure the
    // referenced <defs> path instead (same length for every instance)
    const refId = el.getAttribute('href').slice(1);
    const refPath = document.querySelector(`#${refId} path`);
    const len = refPath.getTotalLength();
    return {
      el,
      len,
      start: parseFloat(el.dataset.start),
      end: parseFloat(el.dataset.end),
    };
  });
  paths.forEach((p) => {
    p.el.style.strokeDasharray = String(p.len);
    p.el.style.strokeDashoffset = String(p.len);
    p.el.style.fillOpacity = '0';
    p.el.style.fill = '#1D4BA8';
    p.el.style.stroke = '#1D4BA8';
  });

  // wilt groups: rotate 180deg around the motif's own center, sink down, darken
  const wiltGroups = motifs.map((g) => {
    const wilt = g.querySelector('.motif-wilt');
    const w = parseFloat(g.dataset.w);
    const h = parseFloat(g.dataset.h);
    return { el: wilt, cx: w / 2, cy: h / 2, h };
  });

  layout();

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

  let ticking = false;
  function update() {
    ticking = false;
    const scrollable = wrap.offsetHeight - window.innerHeight;
    const scrolled = -wrap.getBoundingClientRect().top;
    const progress = scrollable > 0 ? Math.min(1, Math.max(0, scrolled / scrollable)) : 1;

    paths.forEach((p) => {
      const local = smoothstep(p.start, p.end, progress);
      p.el.style.strokeDashoffset = String(p.len * (1 - local));
      p.el.style.fillOpacity = String(smoothstep(0.75, 1, local));
    });

    // wilt phase: 0.56 -> 0.78, flowers droop (180deg) and darken,
    // then the whole ornament layer fades out (0.80 -> 0.92) so the
    // fixed fallen-petals overlay can take over without a visible seam
    const wiltT = smoothstep(0.56, 0.78, progress);
    const color = lerpColor('#1D4BA8', '#1B2A4A', wiltT);
    paths.forEach((p) => {
      p.el.style.fill = color;
      p.el.style.stroke = color;
    });
    wiltGroups.forEach((m) => {
      const sink = wiltT * m.h * 0.3;
      m.el.setAttribute(
        'transform',
        `translate(0,${sink}) rotate(${wiltT * 180},${m.cx},${m.cy})`
      );
    });
    svg.style.opacity = String(1 - smoothstep(0.8, 0.92, progress));

    if (text) {
      const tIn = smoothstep(0.3, 0.4, progress);
      const tOut = smoothstep(0.56, 0.64, progress);
      const t = tIn * (1 - tOut);
      text.style.opacity = String(t);
      text.style.transform = `translateY(${(1 - tIn) * 18 - tOut * 14}px)`;
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

// Fallen petals: fixed overlay that carries the wilted motifs from the
// end of the hero across the seam into the top of the Problem section,
// always above both sections' own backgrounds, continuing to sink.
(function () {
  const heroWrap = document.querySelector('.hero-wrap');
  const problemWrap = document.querySelector('.problem-wrap');
  const overlay = document.querySelector('.fallen-overlay');
  const svg = document.querySelector('.fallen-svg');
  if (!heroWrap || !problemWrap || !overlay || !svg) return;

  const motifs = Array.from(svg.querySelectorAll('.fallen-motif'));

  const SIZE_BY_ROLE = {
    main: { h: 0.46, w: 0.5 },
    secondary: { h: 0.24, w: 0.26 },
    tertiary: { h: 0.17, w: 0.19 },
  };
  const CENTER_OFFSET_BY_ROLE = { main: 0, secondary: 0.16, tertiary: 0.3 };

  let bounds = []; // base placement per motif, computed on layout()
  let fallStart = 0;
  let fallEnd = 1;

  function layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    bounds = motifs.map((g) => {
      const corner = g.dataset.corner;
      const role = g.dataset.role;
      const naturalH = parseFloat(g.dataset.h);
      const size = SIZE_BY_ROLE[role];
      const pxHeight = Math.min(h * size.h, w * size.w);
      const scale = pxHeight / naturalH;
      const bottomAnchor = h - 6;
      const ty = bottomAnchor - pxHeight;
      const edgeOffset = w * 0.02;
      const centerOffset = w * CENTER_OFFSET_BY_ROLE[role];
      let tx, sx;
      if (corner === 'left') {
        tx = -edgeOffset + centerOffset;
        sx = scale;
      } else {
        tx = w + edgeOffset - centerOffset;
        sx = -scale;
      }
      return { el: g, tx, ty, sx, scale, h: naturalH * scale };
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

    // settle near the plate's level, then hold still while fading
    // (does not keep sinking past the plate)
    const settle = smoothstep(0, 0.4, fall) * window.innerHeight * 0.12;
    bounds.forEach((m) => {
      m.el.setAttribute('transform', `translate(${m.tx},${m.ty + settle}) scale(${m.sx},${m.scale})`);
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

    if (head) {
      const t = smoothstep(0, 0.07, progress);
      head.style.opacity = String(t);
      head.style.transform = `translateY(${(1 - t) * 14}px)`;
    }

    const bodyStart = 0.1;
    const segment = (1 - bodyStart) / n;

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
