// ── 3D glass flowers ──────────────────────────────────────────────────────
// Decorative only: one fixed WebGL canvas draws a glass flower into every
// visible .glass-3d box (assets/js/glass-flowers.js, loaded after the page).
// Subpages get boxes beside the content column; /calls/ has its own stage.
// Included on every page with <script src=".../assets/js/glass-loader.js" defer>.
(function () {
  if (document.getElementById('callsStage')) return;
  const main = document.querySelector('main');
  if (!main) return;
  try {
    const c = document.createElement('canvas');
    if (!(c.getContext('webgl2') || c.getContext('webgl'))) return;
  } catch (e) { return; }
  const conn = navigator.connection;
  if (conn && conn.saveData) return;
  // Subpages: boxes in the free margins beside the content column, sized to
  // fit; pages without room (full-width layouts, phones) get none, except a
  // single flower beside the title on list pages (Deals, Team).
  if (!document.querySelector('.glass-3d')) {
    const boxes = [
      { flower: 'rose', side: 'right', top: 40, max: 300 },
      { flower: 'daisy', side: 'left', top: 420, max: 240 },
      { flower: 'tulip', side: 'right', top: 1100, max: 240 },
    ].map((b) => {
      const s = document.createElement('span');
      s.className = 'glass-3d';
      s.dataset.flower = b.flower;
      s.setAttribute('aria-hidden', 'true');
      s.style.display = 'none';
      main.appendChild(s);
      return { ...b, el: s };
    });
    const place = () => {
      const col = [...main.children].find((el) => !el.classList.contains('glass-3d') && el.offsetHeight > 120);
      if (!col) return;
      const r = col.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      const gap = Math.min(r.left - m.left, m.right - r.right);
      const listPage = col.classList.contains('deals-wrap');
      boxes.forEach((b, i) => {
        const st = b.el.style;
        let w = Math.min(b.max, gap - 40);
        let x = (gap - w) / 2;
        let top = b.top;
        if (w < 150 && listPage && i === 0 && window.innerWidth >= 900) {
          // beside the page title, inside the content column
          w = Math.min(240, r.width * 0.26);
          x = gap + 10;
          top = 0;
        } else if (w < 150 || top + w > main.offsetHeight - 80) {
          st.display = 'none';
          return;
        }
        st.display = 'block';
        st.width = `${Math.round(w)}px`;
        st.height = `${Math.round(w)}px`;
        st.top = `${top}px`;
        st.left = b.side === 'left' ? `${Math.round(x)}px` : 'auto';
        st.right = b.side === 'right' ? `${Math.round(x)}px` : 'auto';
      });
    };
    place();
    let t = 0;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(place, 150); }, { passive: true });
    window.addEventListener('load', place, { once: true });
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = () => import('/assets/js/glass-flowers.js?v=1')
    .then((m) => m.mountOrnaments({ reduced }))
    .catch(() => { /* decorative, ignore */ });
  const later = () => ('requestIdleCallback' in window ? requestIdleCallback(start, { timeout: 2500 }) : setTimeout(start, 300));
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
})();
