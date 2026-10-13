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
    const len = el.getTotalLength();
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
    const fadeOut = smoothstep(0.82, 1, fall);
    overlay.style.opacity = String(fadeIn * (1 - fadeOut));

    bounds.forEach((m) => {
      const extraSink = fall * window.innerHeight * 0.65;
      m.el.setAttribute('transform', `translate(${m.tx},${m.ty + extraSink}) scale(${m.sx},${m.scale})`);
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

// Plate: 3D tilt that follows the cursor
(function () {
  const wrap = document.querySelector('.plate-3d');
  const plate = document.querySelector('.plate');
  if (!wrap || !plate) return;

  wrap.addEventListener('pointermove', (e) => {
    const rect = wrap.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5..0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    const rotateY = x * 36;
    const rotateX = -y * 26;
    plate.style.transition = 'transform 0.1s linear';
    plate.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  });
  wrap.addEventListener('pointerleave', () => {
    plate.style.transition = 'transform .6s cubic-bezier(.22,1,.36,1)';
    plate.style.transform = 'rotateX(0deg) rotateY(0deg)';
  });
})();

// Problem: gzhel plate with scroll-cycled slides
(function () {
  const wrap = document.querySelector('.problem-wrap');
  const slides = Array.from(document.querySelectorAll('.problem-slide'));
  if (!wrap || !slides.length) return;

  function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  const n = slides.length;
  const margin = 0.035;
  const bounds = Array.from({ length: n + 1 }, (_, i) => i / n);

  let ticking = false;
  function update() {
    ticking = false;
    const scrollable = wrap.offsetHeight - window.innerHeight;
    const scrolled = -wrap.getBoundingClientRect().top;
    const progress = scrollable > 0 ? Math.min(1, Math.max(0, scrolled / scrollable)) : 0;

    slides.forEach((el, i) => {
      const inStart = i === 0 ? -1 : bounds[i] - margin;
      const inEnd = bounds[i] + margin;
      const outStart = bounds[i + 1] - margin;
      const outEnd = i === n - 1 ? 2 : bounds[i + 1] + margin;
      const fadeIn = smoothstep(inStart, inEnd, progress);
      const fadeOut = smoothstep(outStart, outEnd, progress);
      const opacity = fadeIn * (1 - fadeOut);
      el.style.opacity = String(opacity);
      el.style.transform = `translateY(${(1 - fadeIn) * 16}px)`;
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
