// Diagnostics: what Google returns as busy time for the booking calendar(s).
// Usage (on the server): sudo -u www-data node backend/check-calendar.mjs [calendarId ...]
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const keyFile = process.env.GOOGLE_SA_KEY_FILE || '/etc/vanneck-backend/google-sa.json';
const ids = process.argv.slice(2).length ? process.argv.slice(2) : (process.env.GOOGLE_BUSY_CALENDAR_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!ids.length) { console.error('Pass a calendar id, e.g. node check-calendar.mjs you@gmail.com'); process.exit(1); }

const key = JSON.parse(readFileSync(keyFile, 'utf8'));
console.log('service account:', key.client_email);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/calendar.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
const tok = await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
})).json();
if (!tok.access_token) { console.error('token error:', tok); process.exit(1); }

const timeMin = new Date().toISOString();
const timeMax = new Date(Date.now() + 7 * 86400e3).toISOString();
const fb = await (await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
  method: 'POST',
  headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ timeMin, timeMax, items: ids.map((id) => ({ id })) }),
})).json();
if (fb.error) { console.error('freeBusy error:', JSON.stringify(fb.error)); process.exit(1); }
const tz = process.env.CALLS_TIMEZONE || 'Europe/Amsterdam';
const f = (s) => new Date(s).toLocaleString('en-GB', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
for (const id of ids) {
  const c = fb.calendars?.[id];
  console.log(`\n${id}:`);
  if (!c) { console.log('  not returned'); continue; }
  if (c.errors?.length) { console.log('  errors:', JSON.stringify(c.errors)); continue; }
  if (!c.busy?.length) console.log('  no busy time in the next 7 days');
  for (const x of c.busy || []) console.log(`  busy ${f(x.start)} - ${f(x.end).slice(-5)} (${tz})`);
}
