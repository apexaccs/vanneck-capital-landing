// /calls/: choose a call type, pick a free slot (in the visitor's time zone)
// and book it. Free slots come from the backend, which reads the host's
// Google Calendar; bookings land in the team's Telegram chat.
(function () {
  const root = document.getElementById('calls');
  if (!root) return;

  const TYPES = {
    intro: { label: 'Intro call', minutes: 45 },
    partnership: { label: 'Partnership call', minutes: 60 },
    hiring: { label: 'Hiring interview', minutes: 30 },
    investment: { label: 'Investment call', minutes: 60 },
  };
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const PREFS_KEY = 'vanneck-calls-prefs';
  const PREFILL_KEY = 'vanneck-book';
  const FALLBACK_ZONES = ['UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow', 'Asia/Dubai', 'Asia/Kolkata',
    'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Australia/Sydney', 'America/New_York', 'America/Chicago', 'America/Los_Angeles'];

  const $ = (id) => document.getElementById(id);
  const typeBtns = [...root.querySelectorAll('.calls-type')];
  const tzSel = $('callsTz');
  const hourBtns = [...root.querySelectorAll('.calls-hours button')];
  const daysEl = $('callsDays');
  const slotsEl = $('callsSlots');
  const statusEl = $('callsStatus');
  const stepType = $('stepType');
  const stepTime = $('stepTime');
  const stepDetails = $('stepDetails');
  const pickedEl = $('callsPicked');
  const form = $('callsForm');
  const note = $('callsNote');
  const done = $('callsDone');
  const unavailable = $('callsUnavailable');

  const readJSON = (storage, key) => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch (e) { return null; } };
  const writeJSON = (storage, key, val) => { try { storage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage blocked */ } };

  // ── settings: time zone and 12/24h ─────────────────────────────────────
  let browserTz = 'UTC';
  try { browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* old browser */ }
  let zones;
  try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) { zones = FALLBACK_ZONES.slice(); }
  if (!zones.includes(browserTz)) zones.unshift(browserTz);
  if (!zones.includes('UTC')) zones.push('UTC');

  const offsetOf = (z) => {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
      return p ? p.value : '';
    } catch (e) { return ''; }
  };
  for (const z of zones) {
    const o = document.createElement('option');
    const off = offsetOf(z);
    o.value = z;
    o.textContent = z.replace(/_/g, ' ') + (off ? ` (${off})` : '');
    tzSel.appendChild(o);
  }

  let use12h = false;
  try { use12h = ['h11', 'h12'].includes(new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle); } catch (e) { /* keep 24h */ }
  const prefs = readJSON(localStorage, PREFS_KEY) || {};
  let tz = zones.includes(prefs.tz) ? prefs.tz : browserTz;
  let fmt = prefs.fmt === '12' || prefs.fmt === '24' ? prefs.fmt : (use12h ? '12' : '24');
  tzSel.value = tz;

  const savePrefs = () => writeJSON(localStorage, PREFS_KEY, { tz, fmt });
  const dayKey = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
  const timeLabel = (t) => new Intl.DateTimeFormat(fmt === '12' ? 'en-US' : 'en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: fmt === '12' }).format(t);
  const dayPart = (t, opt) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opt }).format(t);
  const dateLong = (t) => dayPart(t, { weekday: 'short', day: 'numeric', month: 'short' });

  // ── state ──────────────────────────────────────────────────────────────
  let type = null;
  let slots = [];
  let day = null;
  let slot = null;
  let loadSeq = 0;

  function setStatus(html) { statusEl.innerHTML = html || ''; }

  function render() {
    hourBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fmt === fmt)));
    typeBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === type)));
    daysEl.innerHTML = '';
    slotsEl.innerHTML = '';
    if (!type) return;
    const groups = new Map();
    for (const t of slots) {
      const k = dayKey(t);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    if (!groups.size) {
      setStatus('No free times in the next three weeks for this call. Please <a href="../index.html#apply">send us an application</a> and we will come back to you.');
      return;
    }
    if (!day || !groups.has(day)) day = groups.keys().next().value;
    for (const [k, list] of groups) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'calls-day';
      b.dataset.day = k;
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(k === day));
      const t = list[0];
      b.innerHTML = '<span class="d-wd"></span><span class="d-num"></span><span class="d-mon"></span>';
      b.children[0].textContent = dayPart(t, { weekday: 'short' });
      b.children[1].textContent = dayPart(t, { day: 'numeric' });
      b.children[2].textContent = dayPart(t, { month: 'short' });
      b.setAttribute('aria-label', `${dateLong(t)}, ${list.length} free ${list.length === 1 ? 'time' : 'times'}`);
      daysEl.appendChild(b);
    }
    for (const t of groups.get(day)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'calls-slot';
      b.dataset.t = String(t);
      b.setAttribute('aria-pressed', String(t === slot));
      b.textContent = timeLabel(t);
      slotsEl.appendChild(b);
    }
    if (slot) showPicked();
  }

  function showPicked() {
    const m = TYPES[type].minutes * 60e3;
    pickedEl.textContent = `${TYPES[type].label} · ${dateLong(slot)} · ${timeLabel(slot)}-${timeLabel(slot + m)} (${tz.replace(/_/g, ' ')})`;
    const change = document.createElement('button');
    change.type = 'button';
    change.textContent = 'Change';
    change.addEventListener('click', () => {
      slot = null;
      stepDetails.hidden = true;
      render();
      stepTime.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    pickedEl.appendChild(change);
  }

  async function loadType(key) {
    const seq = ++loadSeq;
    type = key;
    slots = [];
    render();
    setStatus('Loading free times...');
    try {
      const r = await fetch(`/api/calls/slots?type=${encodeURIComponent(key)}`, { headers: { Accept: 'application/json' } });
      if (seq !== loadSeq) return;
      if (r.status === 503) { showUnavailable(); return; }
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      if (seq !== loadSeq) return;
      slots = j.slots.map((s) => Date.parse(s));
      if (slot && !slots.includes(slot)) { slot = null; stepDetails.hidden = true; }
      setStatus('');
      render();
    } catch (e) {
      if (seq === loadSeq) setStatus('We could not load free times. Please try again in a minute.');
    }
  }

  function showUnavailable() {
    unavailable.hidden = false;
    stepType.hidden = true;
    stepTime.hidden = true;
    stepDetails.hidden = true;
  }

  // ── events ─────────────────────────────────────────────────────────────
  typeBtns.forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.type === type) return;
    slot = null;
    stepDetails.hidden = true;
    day = null;
    loadType(b.dataset.type);
  }));
  tzSel.addEventListener('change', () => { tz = tzSel.value; savePrefs(); day = slot ? dayKey(slot) : null; render(); });
  hourBtns.forEach((b) => b.addEventListener('click', () => { fmt = b.dataset.fmt; savePrefs(); render(); }));
  daysEl.addEventListener('click', (e) => {
    const b = e.target.closest('.calls-day');
    if (!b) return;
    day = b.dataset.day;
    render();
  });
  slotsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.calls-slot');
    if (!b) return;
    slot = Number(b.dataset.t);
    stepDetails.hidden = false;
    render();
    stepDetails.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ── form ───────────────────────────────────────────────────────────────
  const val = (n) => String(form.elements[n] ? form.elements[n].value : '').trim();
  const normalizeUrl = (v) => (!v ? '' : /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
  const isHttpUrl = (s) => { try { const u = new URL(s); return /^https?:$/.test(u.protocol) && u.hostname.includes('.'); } catch (e) { return false; } };

  function clearErrors() {
    form.querySelectorAll('.field-error').forEach((n) => n.remove());
    form.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
  }
  function setFieldError(name, msg) {
    const input = form.elements[name];
    if (!input || !input.closest) return false;
    const err = document.createElement('span');
    err.className = 'field-error';
    err.setAttribute('role', 'alert');
    err.textContent = msg;
    input.setAttribute('aria-invalid', 'true');
    input.closest('label').appendChild(err);
    return true;
  }
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.getAttribute && t.getAttribute('aria-invalid')) {
      t.removeAttribute('aria-invalid');
      const err = t.closest('label') && t.closest('label').querySelector('.field-error');
      if (err) err.remove();
    }
    note.textContent = '';
  });

  function validate() {
    const err = {};
    if (val('name').length < 2) err.name = 'Please enter your name';
    if (val('company').length < 2) err.company = 'Please enter your company';
    if (!EMAIL_RE.test(val('email'))) err.email = 'Please enter a valid email';
    if (val('role').length > 100) err.role = 'This is too long';
    if (val('link') && !isHttpUrl(normalizeUrl(val('link')))) err.link = 'Please enter a valid link';
    if (val('contact').length > 100) err.contact = 'This is too long';
    if (val('source').length > 200) err.source = 'This is too long';
    const inq = val('inquiry');
    if (inq.length < 10) err.inquiry = 'Please tell us a bit more (at least 10 characters)';
    else if (inq.length > 1500) err.inquiry = 'Please keep it under 1500 characters';
    return err;
  }

  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !type || !slot) return;
    if (val('website')) return;
    clearErrors();
    note.textContent = '';
    const errors = validate();
    const names = Object.keys(errors);
    if (names.length) {
      names.forEach((n) => setFieldError(n, errors[n]));
      form.elements[names[0]].focus();
      return;
    }
    busy = true;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    note.textContent = 'Booking...';
    const payload = {
      type, start: new Date(slot).toISOString(), timeZone: tz,
      name: val('name'), company: val('company'), email: val('email'), inquiry: val('inquiry'),
      role: val('role'), link: normalizeUrl(val('link')), contact: val('contact'), stage: val('stage'), source: val('source'),
    };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch('/api/calls/book', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal,
      });
      clearTimeout(timer);
      let body = null;
      try { body = await r.json(); } catch (err) { /* not JSON */ }
      if (r.ok && body && body.booking) { showDone(body.booking); return; }
      if (r.status === 400 && body && body.field) {
        note.textContent = '';
        if (!setFieldError(body.field, body.error || 'Please check this field')) note.textContent = body.error || 'Please check your details';
        return;
      }
      if (r.status === 409) {
        note.textContent = '';
        slot = null;
        stepDetails.hidden = true;
        await loadType(type);
        setStatus('That time has just been taken. Please pick another one.');
        stepTime.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (r.status === 429) { note.textContent = 'Too many attempts. Please wait a few minutes and try again.'; return; }
      if (r.status === 503) { showUnavailable(); return; }
      note.textContent = 'Something went wrong on our side. Your details are still here: please try again in a minute.';
    } catch (err) {
      note.textContent = 'Something went wrong on our side. Your details are still here: please try again in a minute.';
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });

  function showDone(b) {
    const start = Date.parse(b.start);
    const end = Date.parse(b.end);
    done.querySelector('.calls-when').textContent = `${b.label} · ${dateLong(start)} · ${timeLabel(start)}-${timeLabel(end)} (${tz.replace(/_/g, ' ')})`;
    const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vanneck Capital//Calls//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', `UID:${b.id}@vanneck.xyz`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:${b.label} with Vanneck Capital`, 'DESCRIPTION:We will email you the meeting link.', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
    const link = $('callsIcs');
    link.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    stepType.hidden = true;
    stepTime.hidden = true;
    stepDetails.hidden = true;
    done.hidden = false;
    try { sessionStorage.removeItem(PREFILL_KEY); } catch (e) { /* storage blocked */ }
    done.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── start: prefill from the main page, optional ?type= ──────────────────
  const pre = readJSON(sessionStorage, PREFILL_KEY) || {};
  const q = new URLSearchParams(location.search);
  for (const k of ['name', 'company', 'email']) {
    const v = String(pre[k] || q.get(k) || '').trim().slice(0, 200);
    if (v && form.elements[k]) form.elements[k].value = v;
  }
  render();
  if (TYPES[q.get('type')]) loadType(q.get('type'));
  else setStatus('Choose a call type above to see free times.');
})();
