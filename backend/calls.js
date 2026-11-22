// Call booking: free slots from Google Calendar (read-only) and bookings that
// land in the Telegram chat.
//
// Availability = weekly hours from CALLS_HOURS (or, if that is not set, events
// in a dedicated "call hours" calendar), minus busy time in the host's main
// calendar(s), minus calls already booked here. Google is only read, never
// written. Bookings are kept locally (time, name, company, email, time zone,
// meeting link) so the same slot cannot be taken twice and the follow-up
// emails can be sent (call-bot.js); they are deleted two days after the call.

import { createSign, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { startFollowups } from './call-bot.js';

export const CALL_TYPES = {
  intro: { label: 'Intro call', minutes: 45 },
  partnership: { label: 'Partnership call', minutes: 60 },
  hiring: { label: 'Hiring interview', minutes: 30 },
  investment: { label: 'Investment call', minutes: 60 },
};

const STAGES = ['Pre-seed', 'Seed', 'Series A', 'Other'];

const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d);
const KEY_FILE = process.env.GOOGLE_SA_KEY_FILE;
const AVAILABILITY_ID = process.env.GOOGLE_AVAILABILITY_CALENDAR_ID;
const BUSY_IDS = (process.env.GOOGLE_BUSY_CALENDAR_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MIN_NOTICE_MS = num(process.env.CALLS_MIN_NOTICE_HOURS, 12) * 3600e3;
const HORIZON_MS = num(process.env.CALLS_HORIZON_DAYS, 21) * 86400e3;
const BUFFER_MS = num(process.env.CALLS_BUFFER_MINUTES, 15) * 60e3;
const STEP_MS = num(process.env.CALLS_STEP_MINUTES, 30) * 60e3;
const HOURS_TZ = (process.env.CALLS_TIMEZONE || '').trim();
const WEEKLY = parseWeekly(process.env.CALLS_HOURS || '');
const CACHE_MS = 60e3;
const STORE_FILE = process.env.BOOKINGS_FILE
  || path.join(process.env.STATE_DIRECTORY || '/var/lib/vanneck-backend', 'bookings.json');

// ---------- Google service account auth (JWT bearer, read-only scope) ----------
let saKey = null;
let token = null;

async function accessToken() {
  if (token && token.exp - 60e3 > Date.now()) return token.value;
  if (!saKey) saKey = JSON.parse(await readFile(KEY_FILE, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: saKey.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(saKey.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`google token ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

async function gapi(url, init = {}) {
  const r = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`google ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// CALLS_HOURS="Mon 18:00-20:30; Sat 10:00-12:00, 13:00-19:30" in CALLS_TIMEZONE.
// Returns { weekday (0 = Sun): [[startMin, endMin], ...] } or null if unset/invalid.
function parseWeekly(src) {
  if (!src.trim()) return null;
  const days = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const out = {};
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  for (const part of src.split(';').map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^([a-z]{3})[a-z]*\s+(.+)$/i);
    const wd = m && days[m[1].toLowerCase()];
    if (wd === undefined) { console.error(`CALLS_HOURS: cannot read "${part}"`); return null; }
    for (const r of m[2].split(',').map((x) => x.trim())) {
      const rm = r.match(/^([01]?\d|2[0-3]):([0-5]\d)\s*-\s*([01]?\d|2[0-4]):([0-5]\d)$/);
      const a = rm && toMin(`${rm[1]}:${rm[2]}`), b = rm && toMin(`${rm[3]}:${rm[4]}`);
      if (!rm || b <= a || b > 1440) { console.error(`CALLS_HOURS: bad range "${r}" in "${part}"`); return null; }
      (out[wd] ||= []).push([a, b]);
    }
  }
  return out;
}

// UTC offset (ms) of a time zone at instant t.
function tzOffset(t, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}
// Wall-clock time in tz -> epoch ms (DST-safe).
function zoned(y, mo, d, minutes, tz) {
  const guess = Date.UTC(y, mo, d, 0, minutes);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz);
  return t;
}

function weeklyWindows(now) {
  const tz = HOURS_TZ || 'UTC';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(now)).map((x) => [x.type, Number(x.value)]));
  const windows = [];
  const days = Math.ceil(HORIZON_MS / 86400e3) + 2;
  for (let i = 0; i <= days; i++) {
    const date = new Date(Date.UTC(p.year, p.month - 1, p.day + i));
    const [y, mo, d] = [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
    for (const [a, b] of WEEKLY[date.getUTCDay()] || []) windows.push([zoned(y, mo, d, a, tz), zoned(y, mo, d, b, tz)]);
  }
  return { windows, timeZone: tz };
}

async function fetchWindows(timeMin, timeMax) {
  if (WEEKLY) return weeklyWindows(Date.parse(timeMin));
  const windows = [];
  let timeZone = 'UTC';
  let pageToken;
  do {
    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' });
    if (pageToken) q.set('pageToken', pageToken);
    const j = await gapi(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(AVAILABILITY_ID)}/events?${q}`);
    if (j.timeZone) timeZone = j.timeZone;
    for (const ev of j.items || []) {
      if (ev.status === 'cancelled' || !ev.start?.dateTime || !ev.end?.dateTime) continue;
      windows.push([Date.parse(ev.start.dateTime), Date.parse(ev.end.dateTime)]);
    }
    pageToken = j.nextPageToken;
  } while (pageToken);
  return { windows, timeZone };
}

async function fetchBusy(timeMin, timeMax) {
  if (!BUSY_IDS.length) return [];
  const j = await gapi('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, items: BUSY_IDS.map((id) => ({ id })) }),
  });
  const busy = [];
  for (const id of BUSY_IDS) {
    const c = j.calendars?.[id];
    if (!c || c.errors?.length) throw new Error(`freeBusy ${id}: ${JSON.stringify(c?.errors || 'missing')}`);
    for (const b of c.busy || []) busy.push([Date.parse(b.start), Date.parse(b.end)]);
  }
  return busy;
}

// Calendar data is shared by all call types and cached for a minute, so
// visitors browsing the page cost at most one Google round-trip per minute.
let cache = null;
let inflight = null;

async function calendarData(fresh = false) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache;
  if (!fresh && inflight) return inflight;
  const run = (async () => {
    const now = Date.now();
    const timeMin = new Date(now).toISOString();
    const timeMax = new Date(now + HORIZON_MS + 86400e3).toISOString();
    const [{ windows, timeZone }, busy] = await Promise.all([fetchWindows(timeMin, timeMax), fetchBusy(timeMin, timeMax)]);
    cache = { at: Date.now(), windows, busy, timeZone };
    return cache;
  })();
  if (!fresh) inflight = run.finally(() => { inflight = null; });
  return run;
}

export function computeSlots({ windows, busy, booked, minutes, now }) {
  const dur = minutes * 60e3;
  const earliest = now + MIN_NOTICE_MS;
  const latest = now + HORIZON_MS;
  const blocks = [...busy, ...booked].map(([s, e]) => [s - BUFFER_MS, e + BUFFER_MS]);
  const out = new Set();
  for (const [ws, we] of windows) {
    for (let t = ws; t + dur <= we; t += STEP_MS) {
      if (t < earliest || t > latest) continue;
      if (blocks.some(([bs, be]) => t < be && t + dur > bs)) continue;
      out.add(t);
    }
  }
  return [...out].sort((a, b) => a - b);
}

// ---------- local store of bookings (file mode 600, pruned 2 days after the call) ----------
async function readStore() {
  try {
    return JSON.parse(await readFile(STORE_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeStore(list) {
  await mkdir(path.dirname(STORE_FILE), { recursive: true });
  const tmp = `${STORE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(list), { mode: 0o600 });
  await rename(tmp, STORE_FILE);
}

let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

const hostTz = () => (cache && cache.timeZone) || HOURS_TZ || 'UTC';
const configured = () => Boolean(WEEKLY ? (KEY_FILE || !BUSY_IDS.length) : (KEY_FILE && AVAILABILITY_ID));

function fmt(ms, timeZone, withDate = true) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    ...(withDate ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

function validTimeZone(tz) {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const gcalStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function registerCallRoutes(app, { sendTelegram, escapeHtml, isValidEmail, isHttpUrl, bad, clean }) {
  const followups = startFollowups({ readStore, writeStore, withLock, CALL_TYPES, hostTz, chatId: process.env.TELEGRAM_CHAT_ID });
  app.get('/api/calls/slots', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const type = CALL_TYPES[req.query.type];
    if (!type) return res.status(400).json({ ok: false, error: 'Unknown call type' });
    if (!configured()) return res.status(503).json({ ok: false, error: 'calendar_unavailable' });
    try {
      const data = await calendarData();
      const booked = (await readStore()).map((b) => [b.start, b.end]);
      const slots = computeSlots({ windows: data.windows, busy: data.busy, booked, minutes: type.minutes, now: Date.now() });
      res.json({ ok: true, minutes: type.minutes, hostTimeZone: data.timeZone, slots: slots.map((t) => new Date(t).toISOString()) });
    } catch (err) {
      console.error('calls/slots:', err.message);
      res.status(503).json({ ok: false, error: 'calendar_unavailable' });
    }
  });

  app.post('/api/calls/book', async (req, res) => {
    try {
      const body = req.body || {};
      if (body.website) return res.json({ ok: true }); // honeypot tripped - pretend success

      const typeKey = clean(body.type);
      const type = CALL_TYPES[typeKey];
      const start = Date.parse(clean(body.start));
      const name = clean(body.name);
      const company = clean(body.company);
      const email = clean(body.email);
      const inquiry = clean(body.inquiry);
      const role = clean(body.role);
      const link = clean(body.link);
      const contact = clean(body.contact);
      const stage = clean(body.stage);
      const source = clean(body.source);
      const guestTz = validTimeZone(clean(body.timeZone)) ? clean(body.timeZone) : '';

      if (!type) return bad(res, 'type', 'Please choose a call type');
      if (!Number.isFinite(start)) return bad(res, 'start', 'Please choose a time');
      if (name.length < 2 || name.length > 100) return bad(res, 'name', 'Please enter your name');
      if (company.length < 2 || company.length > 150) return bad(res, 'company', 'Please enter your company');
      if (!isValidEmail(email)) return bad(res, 'email', 'Please enter a valid email');
      if (inquiry.length < 10 || inquiry.length > 1500) return bad(res, 'inquiry', 'Please tell us what the call is about (10-1500 characters)');
      if (role.length > 100) return bad(res, 'role', 'This is too long');
      if (link && (link.length > 300 || !isHttpUrl(link))) return bad(res, 'link', 'Please enter a valid link');
      if (contact.length > 100) return bad(res, 'contact', 'This is too long');
      if (stage && !STAGES.includes(stage)) return bad(res, 'stage', 'Please choose a stage');
      if (source.length > 200) return bad(res, 'source', 'This is too long');
      if (!configured()) return res.status(503).json({ ok: false, error: 'calendar_unavailable' });

      return await withLock(async () => {
        let data;
        try {
          data = await calendarData(true);
        } catch (err) {
          console.error('calls/book calendar:', err.message);
          return res.status(503).json({ ok: false, error: 'calendar_unavailable' });
        }
        const now = Date.now();
        // keep finished calls for two days, then drop them with the guest's details
        const store = (await readStore()).filter((b) => b.end > now - 2 * 86400e3);
        const slots = computeSlots({ windows: data.windows, busy: data.busy, booked: store.map((b) => [b.start, b.end]), minutes: type.minutes, now });
        if (!slots.includes(start)) return res.status(409).json({ ok: false, error: 'slot_taken' });

        const end = start + type.minutes * 60e3;
        const id = randomUUID();
        const hostTimeZone = data.timeZone;
        const booking = { id, type: typeKey, start, end, createdAt: now, name, company, email, tz: guestTz || hostTimeZone, meetLink: '', sent: {} };
        await writeStore([...store, booking]);

        const hostTz = data.timeZone;
        const calUrl = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
          action: 'TEMPLATE',
          text: `${type.label}: ${name} (${company})`,
          dates: `${gcalStamp(start)}/${gcalStamp(end)}`,
          details: [`Booked on vanneck.xyz`, `Email: ${email}`, contact && `Telegram / X: ${contact}`, link && `Link: ${link}`].filter(Boolean).join('\n'),
        });
        const details = [
          '<b>New call booking</b>',
          `<b>Type:</b> ${escapeHtml(type.label)} (${type.minutes} min)`,
          `<b>When:</b> ${escapeHtml(fmt(start, hostTz))}-${escapeHtml(fmt(end, hostTz, false))} (${escapeHtml(hostTz)})`,
          guestTz && guestTz !== hostTz && `<b>Guest time:</b> ${escapeHtml(fmt(start, guestTz))} (${escapeHtml(guestTz)})`,
          `<b>Name:</b> ${escapeHtml(name)}`,
          `<b>Company:</b> ${escapeHtml(company)}`,
          `<b>Email:</b> ${escapeHtml(email)}`,
          role && `<b>Role:</b> ${escapeHtml(role)}`,
          link && `<b>Link:</b> ${escapeHtml(link)}`,
          contact && `<b>Telegram / X:</b> ${escapeHtml(contact)}`,
          stage && `<b>Stage:</b> ${escapeHtml(stage)}`,
          source && `<b>Heard about us:</b> ${escapeHtml(source)}`,
        ].filter(Boolean);
        const text = `${details.join('\n')}\n\n<b>Inquiry:</b>\n${escapeHtml(inquiry)}\n\n<a href="${escapeHtml(calUrl)}">Add to Google Calendar</a>`;

        if (!(await followups.notifyBooking(text, booking)) && !(await sendTelegram(text))) {
          await writeStore(store);
          return res.status(502).json({ ok: false, error: 'Delivery failed' });
        }
        followups.kick(); // confirmation email
        res.json({
          ok: true,
          booking: { id, type: typeKey, label: type.label, minutes: type.minutes, start: new Date(start).toISOString(), end: new Date(end).toISOString() },
        });
      });
    } catch (err) {
      console.error('calls/book: unexpected error', err);
      res.status(500).json({ ok: false, error: 'Server error' });
    }
  });
}
