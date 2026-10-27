// Blog listing: intercepts card clicks to show the article in a modal
// (fetched from its real standalone page), while leaving the underlying
// <a href="slug.html"> links fully functional without JS / for crawlers.
(function () {
  const grid = document.getElementById('blogGrid');
  const overlay = document.getElementById('blogModalOverlay');
  if (!grid || !overlay) return;

  const closeBtn = document.getElementById('blogModalClose');
  const imgEl = document.getElementById('blogModalImg');
  const dateEl = document.getElementById('blogModalDate');
  const titleEl = document.getElementById('blogModalTitle');
  const textEl = document.getElementById('blogModalText');
  const permalinkEl = document.getElementById('blogModalPermalink');

  const cache = {};

  async function loadPost(slug) {
    if (cache[slug]) return cache[slug];
    const res = await fetch(slug + '.html');
    if (!res.ok) throw new Error('fetch failed');
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const data = {
      title: doc.querySelector('h1')?.textContent || '',
      date: doc.querySelector('.blog-post-head time')?.getAttribute('datetime') || '',
      dateHuman: doc.querySelector('.blog-post-head time')?.textContent || '',
      img: doc.querySelector('.blog-post-banner')?.getAttribute('src') || '',
      bodyHtml: doc.querySelector('#post-content')?.innerHTML || '',
    };
    cache[slug] = data;
    return data;
  }

  function openModal(slug, push) {
    loadPost(slug).then((data) => {
      imgEl.src = data.img;
      imgEl.alt = data.title;
      dateEl.textContent = data.dateHuman;
      dateEl.setAttribute('datetime', data.date);
      titleEl.textContent = data.title;
      textEl.innerHTML = data.bodyHtml;
      permalinkEl.href = slug + '.html';
      document.title = data.title + ' - Vanneck Capital Blog';

      overlay.hidden = false;
      requestAnimationFrame(() => overlay.classList.add('is-open'));
      document.body.style.overflow = 'hidden';

      if (push) history.pushState({ blogSlug: slug }, '', slug + '.html');
    }).catch(() => {
      // fall back to a real navigation if fetch/parsing fails for any reason
      window.location.href = slug + '.html';
    });
  }

  function closeModal(push) {
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(() => { overlay.hidden = true; }, 250);
    document.title = 'Blog - Vanneck Capital';
    if (push) history.pushState({}, '', './');
  }

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.blog-card');
    if (!card) return;
    e.preventDefault();
    openModal(card.dataset.slug, true);
  });

  closeBtn.addEventListener('click', () => closeModal(true));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(true); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeModal(true);
  });

  window.addEventListener('popstate', (e) => {
    const slug = e.state && e.state.blogSlug;
    if (slug) openModal(slug, false);
    else closeModal(false);
  });
})();
