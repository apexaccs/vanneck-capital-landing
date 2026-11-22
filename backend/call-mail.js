// Emails for booked calls, sent through Resend:
//   confirm - right after booking: details, add-to-calendar links, .ics
//   day     - reminder the day before
//   link    - the meeting link (normally 1 hour before; can be sent earlier)
// Plain HTML with inline styles and table layout, so it renders the same in
// Gmail, Outlook and Apple Mail; every email also has a text version.

import { Buffer } from 'node:buffer';

const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM; // e.g. "Vanneck Capital <admin@vanneck.xyz>"
const REPLY_TO = process.env.RESEND_REPLY_TO || '';
const FROM_EMAIL = (/<([^>]+)>/.exec(FROM || '') || [])[1] || FROM || 'admin@vanneck.xyz';
const SITE = 'https://vanneck.xyz';

export const mailConfigured = () => Boolean(API_KEY && FROM);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function tzName(tz) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
    if (p && !/^GMT[+-]/.test(p.value)) return p.value === 'Coordinated Universal Time' ? 'UTC' : p.value;
  } catch (e) { /* fall through */ }
  return tz.replace(/_/g, ' ');
}

export function when(b) {
  const tz = b.tz || 'UTC';
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(b.start);
  const t = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(ms);
  return { day, time: `${t(b.start)} - ${t(b.end)}`, zone: tzName(tz) };
}

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function calendarLinks(b, label) {
  const title = `${label} with Vanneck Capital`;
  const details = b.meetLink ? `Join: ${b.meetLink}` : 'We will email you the meeting link one hour before the call.';
  const google = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${stamp(b.start)}/${stamp(b.end)}`, details });
  const outlook = 'https://outlook.live.com/calendar/0/action/compose?' + new URLSearchParams({
    subject: title, startdt: new Date(b.start).toISOString(), enddt: new Date(b.end).toISOString(), body: details, path: '/calendar/action/compose', rru: 'addevent',
  });
  return { google, outlook, title, details };
}

function ics(b, label) {
  const { title, details } = calendarLinks(b, label);
  const fold = (s) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vanneck Capital//Calls//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${b.id}@vanneck.xyz`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(b.start)}`, `DTEND:${stamp(b.end)}`,
    `SUMMARY:${fold(title)}`, `DESCRIPTION:${fold(details)}`, b.meetLink ? `URL:${b.meetLink}` : null, `ORGANIZER;CN=Vanneck Capital:mailto:${FROM_EMAIL}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Call with Vanneck Capital', 'TRIGGER:-PT15M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n') + '\r\n';
}

// ── layout ──────────────────────────────────────────────────────────────
const C = { cobalt: '#1D4BA8', deep: '#0F2C6B', ink: '#14213D', soft: '#3B4A66', pale: '#EEF3FC', line: '#DCE5F7' };
const SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const SANS = "Inter,'Segoe UI',Helvetica,Arial,sans-serif";

function button(href, text, primary = true) {
  return `<a href="${esc(href)}" target="_blank" style="display:inline-block;white-space:nowrap;padding:13px 20px;border-radius:10px;font:600 15px ${SANS};text-decoration:none;${primary
    ? `background:${C.cobalt};color:#ffffff;border:1px solid ${C.cobalt};`
    : `background:#ffffff;color:${C.cobalt};border:1px solid #C9D6F2;`}">${esc(text)}</a>`;
}

function detailRows(rows) {
  return rows.map(([k, v], i) => `<tr>
    <td style="padding:12px 0;${i ? `border-top:1px solid ${C.line};` : ''}font:600 11px ${SANS};letter-spacing:.08em;text-transform:uppercase;color:${C.soft};width:96px;vertical-align:top">${esc(k)}</td>
    <td style="padding:12px 0;${i ? `border-top:1px solid ${C.line};` : ''}font:600 17px ${SERIF};color:${C.ink};vertical-align:top">${v}</td></tr>`).join('');
}

function layout({ preheader, eyebrow, title, intro, body }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only">
<title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${C.pale}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.pale};background-image:radial-gradient(circle at 15% 0%,#dfe8ff 0,${C.pale} 45%)">
<tr><td align="center" style="padding:36px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">
    <tr><td align="center" style="padding:0 0 22px">
      <a href="${SITE}" style="text-decoration:none"><img src="${SITE}/assets/img/mark-v.png" width="42" height="30" alt="" style="display:inline-block;vertical-align:middle;border:0">
      <span style="display:inline-block;vertical-align:middle;margin-left:10px;font:600 22px ${SERIF};letter-spacing:.06em;color:${C.cobalt}">VANNECK</span>
      <span style="display:inline-block;vertical-align:middle;margin-left:6px;font:500 10px ${SANS};letter-spacing:.4em;color:#3F73D1">CAPITAL</span></a>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid #ffffff;border-radius:24px;box-shadow:0 24px 60px -34px rgba(15,44,107,.45);overflow:hidden">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="height:6px;background:${C.cobalt};background-image:linear-gradient(90deg,${C.cobalt},#6F95EC,${C.cobalt});font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td style="padding:34px 36px 8px">
          <p style="margin:0 0 10px;font:600 11px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:#3F73D1">${esc(eyebrow)}</p>
          <h1 style="margin:0 0 14px;font:600 32px/1.15 ${SERIF};color:${C.ink}">${title}</h1>
          <p style="margin:0;font:400 17px/1.55 ${SERIF};color:${C.soft}">${intro}</p>
        </td></tr>
        <tr><td style="padding:22px 36px 34px">${body}</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:22px 20px 0;text-align:center;font:400 12.5px/1.6 ${SANS};color:#6B7894">
      Vanneck Capital never asks founders to pay for a call, a term sheet or a listing.<br>
      If someone does, verify them on <a href="${SITE}/team/" style="color:${C.cobalt}">vanneck.xyz/team</a>.<br><br>
      You receive this email because you booked a call at <a href="${SITE}/calls/" style="color:${C.cobalt}">vanneck.xyz</a>.${REPLY_TO ? ' Need to change something? Just reply to this email.' : ''}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// ── the three emails ────────────────────────────────────────────────────
export function render(kind, b, label, minutes) {
  const w = when(b);
  const first = esc(String(b.name || '').split(/\s+/)[0] || 'there');
  const cal = calendarLinks(b, label);
  const rows = detailRows([
    ['Call', `${esc(label)} <span style="font:400 15px ${SERIF};color:${C.soft}">· ${minutes} min</span>`],
    ['Date', esc(w.day)],
    ['Time', `${esc(w.time)}<br><span style="font:400 14px ${SANS};color:${C.soft}">${esc(w.zone)}</span>`],
    ['Meeting', b.meetLink ? `<a href="${esc(b.meetLink)}" style="color:${C.cobalt}">${esc(b.meetLink)}</a>` : `<span style="font-weight:500;color:${C.soft}">Link arrives by email 1 hour before</span>`],
  ]);
  const details = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.pale};border-radius:16px;padding:6px 20px">${rows}</table>`;
  const calButtons = `<p style="margin:26px 0 10px;font:600 11px ${SANS};letter-spacing:.12em;text-transform:uppercase;color:#3F73D1">Add to your calendar</p>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding:0 8px 8px 0">${button(cal.google, 'Google Calendar')}</td>
      <td style="padding:0 8px 8px 0">${button(cal.outlook, 'Outlook', false)}</td>
    </tr></table>
    <p style="margin:2px 0 0;font:400 13px ${SANS};color:${C.soft}">Apple Calendar or another app: open the attached <b>vanneck-call.ics</b>.</p>`;
  const textBlock = `${label} (${minutes} min)\n${w.day}\n${w.time} (${w.zone})`;

  if (kind === 'confirm') {
    return {
      subject: `Your ${label.toLowerCase()} with Vanneck Capital is booked`,
      html: layout({
        preheader: `${w.day}, ${w.time} (${w.zone})`,
        eyebrow: 'Call confirmed',
        title: 'Your call is booked',
        intro: `Hi ${first}, thank you for booking a call with Vanneck Capital. Here are the details. We will email you the meeting link one hour before the call.`,
        body: details + calButtons,
      }),
      text: `Hi ${b.name},\n\nYour call with Vanneck Capital is booked.\n\n${textBlock}\n\nWe will email you the meeting link one hour before the call.\n\nAdd to Google Calendar: ${cal.google}\nAdd to Outlook: ${cal.outlook}\n\nVanneck Capital - ${SITE}`,
      attachments: [{ filename: 'vanneck-call.ics', content: Buffer.from(ics(b, label)).toString('base64') }],
    };
  }
  if (kind === 'day') {
    const dayKey = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: b.tz || 'UTC' }).format(ms);
    const rel = dayKey(b.start) === dayKey(Date.now()) ? 'today' : 'tomorrow';
    return {
      subject: `Reminder: your call with Vanneck Capital is ${rel}`,
      html: layout({
        preheader: `${rel === 'today' ? 'Today' : 'Tomorrow'}, ${w.time} (${w.zone})`,
        eyebrow: 'Reminder',
        title: `See you ${rel}`,
        intro: `Hi ${first}, a quick reminder about your call with Vanneck Capital. ${b.meetLink ? 'The meeting link is below.' : 'We will send the meeting link one hour before we start.'}`,
        body: details + (b.meetLink ? `<p style="margin:26px 0 0">${button(b.meetLink, 'Join the call')}</p>` : calButtons),
      }),
      text: `Hi ${b.name},\n\nA reminder about your call with Vanneck Capital ${rel}.\n\n${textBlock}\n\n${b.meetLink ? `Join: ${b.meetLink}` : 'We will send the meeting link one hour before the call.'}\n\nVanneck Capital - ${SITE}`,
      attachments: b.meetLink ? [] : [{ filename: 'vanneck-call.ics', content: Buffer.from(ics(b, label)).toString('base64') }],
    };
  }
  // link
  const soon = b.start - Date.now() <= 75 * 60e3;
  return {
    subject: soon ? `Your call with Vanneck Capital starts in 1 hour` : `Your meeting link for the call with Vanneck Capital`,
    html: layout({
      preheader: `${w.time} (${w.zone}) - join link inside`,
      eyebrow: soon ? 'Starting soon' : 'Meeting link',
      title: soon ? 'We start in one hour' : 'Your meeting link',
      intro: `Hi ${first}, here is the link to join your call with Vanneck Capital. See you ${soon ? 'soon' : `on ${esc(w.day)}`}.`,
      body: `<p style="margin:0 0 24px">${button(b.meetLink, 'Join the call')}</p>` + details
        + `<p style="margin:18px 0 0;font:400 13px ${SANS};color:${C.soft}">If the button does not work, copy this link: <a href="${esc(b.meetLink)}" style="color:${C.cobalt};word-break:break-all">${esc(b.meetLink)}</a></p>`,
    }),
    text: `Hi ${b.name},\n\nHere is the link to join your call with Vanneck Capital:\n${b.meetLink}\n\n${textBlock}\n\nVanneck Capital - ${SITE}`,
    attachments: [],
  };
}

export async function sendCallEmail(kind, b, label, minutes, nonce = '') {
  if (!mailConfigured()) throw new Error('RESEND_API_KEY / RESEND_FROM not set');
  const m = render(kind, b, label, minutes);
  const payload = { from: FROM, to: [b.email], subject: m.subject, html: m.html, text: m.text };
  if (REPLY_TO) payload.reply_to = REPLY_TO;
  if (m.attachments.length) payload.attachments = m.attachments;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      // same email is never sent twice, even if a retry races a slow response
      'Idempotency-Key': `${b.id}-${kind}-${b.meetLink ? Buffer.from(b.meetLink).toString('base64url').slice(-24) : 'nolink'}${nonce ? `-${nonce}` : ''}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).id;
}
