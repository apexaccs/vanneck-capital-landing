// Hero: scroll-driven gzhel ornament draw
(function () {
  const wrap = document.querySelector('.hero-wrap');
  const svg = document.querySelector('.gzhel-svg');
  const text = document.querySelector('.hero-text');
  if (!wrap || !svg) return;

  const motifs = Array.from(svg.querySelectorAll('.motif'));
  const stage = document.querySelector('.hero-stage');

  function layout() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    motifs.forEach((g) => {
      const corner = g.dataset.corner; // left | right
      const role = g.dataset.role; // main | secondary
      const naturalH = parseFloat(g.dataset.h);
      const pxHeight =
        role === 'main'
          ? Math.min(h * 0.46, w * 0.5)
          : Math.min(h * 0.24, w * 0.26);
      const scale = pxHeight / naturalH;
      const bottomAnchor = h - 6;
      const ty = bottomAnchor - pxHeight;
      const edgeOffset = w * 0.02;
      const centerOffset = role === 'main' ? 0 : w * 0.16;

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
  });

  layout();

  function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
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

    if (text) {
      const t = smoothstep(0.74, 1, progress);
      text.style.opacity = String(t);
      text.style.transform = `translateY(${(1 - t) * 18}px)`;
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
