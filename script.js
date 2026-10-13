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

// Application form.
// No backend is wired up yet. Replace FORM_ENDPOINT with a real endpoint
// (Formspree, Tally, a serverless function) once the domain/mailbox from
// the launch checklist is live. Until then this falls back to a mailto draft.
const FORM_ENDPOINT = '';
const CONTACT_EMAIL = 'apply@vanneckcapital.com'; // placeholder — set once the real domain is registered

const form = document.getElementById('applyForm');
const note = document.getElementById('formNote');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());

    if (FORM_ENDPOINT) {
      note.textContent = 'Sending…';
      try {
        const res = await fetch(FORM_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('request failed');
        note.textContent = 'Sent. We reply within 2 business days.';
        form.reset();
      } catch (err) {
        note.textContent = 'Something went wrong. Email us directly at ' + CONTACT_EMAIL + '.';
      }
      return;
    }

    const subject = encodeURIComponent('Application: ' + (data.project || 'Untitled project'));
    const body = encodeURIComponent(
      `Project: ${data.project}\nFounder: ${data.name}\nContact: ${data.contact}\nLink: ${data.link}\nStage: ${data.stage}\n\n${data.message || ''}`
    );
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
    note.textContent = 'Opening your email client…';
  });
}
