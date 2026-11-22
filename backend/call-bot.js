// Follow-ups for booked calls:
//  - a scheduler (every minute) sends the emails: confirmation right away,
//    a reminder the day before, the meeting link 1 hour before;
//  - a private Telegram bot (long polling, no webhook needed) where the team
//    adds the meeting link to each call, sends it early or resends emails.
// Only Telegram users listed in TELEGRAM_ADMIN_IDS can use the bot; anyone
// else gets their numeric id back so it can be added.

import { sendCallEmail, mailConfigured, when } from './call-mail.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMINS = new Set((process.env.TELEGRAM_ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
const HOUR = 3600e3;
const MAX_TRIES = 3;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isUrl = (s) => { try { const u = new URL(s); return /^https?:$/.test(u.protocol) && u.hostname.includes('.'); } catch (e) { return false; } };

async function tg(method, payload) {
  if (!TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(method === 'getUpdates' ? 65000 : 10000),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) console.error(`telegram ${method}:`, r.status, j.description || '');
    return j;
  } catch (err) {
    if (method !== 'getUpdates') console.error(`telegram ${method}:`, err.message);
    return null;
  }
}

export function startFollowups({ readStore, writeStore, withLock, CALL_TYPES, hostTz, chatId }) {
  let botName = '';
  const label = (b) => CALL_TYPES[b.type]?.label || 'Call';
  const minutes = (b) => CALL_TYPES[b.type]?.minutes || Math.round((b.end - b.start) / 60e3);
  const hostWhen = (ms, withDay = true) => new Intl.DateTimeFormat('en-GB', {
    timeZone: hostTz(), ...(withDay ? { weekday: 'short', day: 'numeric', month: 'short' } : {}), hour: '2-digit', minute: '2-digit',
  }).format(ms);
  const deepLink = (b) => (botName ? `https://t.me/${botName}?start=link_${b.id}` : '');
  const linkKeyboard = (b) => (deepLink(b) ? { inline_keyboard: [[{ text: b.meetLink ? '🔗 Change meeting link' : '🔗 Add meeting link', url: deepLink(b) }]] } : undefined);
  const toChat = (text, markup) => (chatId ? tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup }) : null);

  // ── emails ────────────────────────────────────────────────────────────
  // key: where the result is recorded (an early manual link email is kept
  // apart, so the 1-hour-before email still goes out)
  async function send(kind, b, nonce, key = kind) {
    try {
      await sendCallEmail(kind, b, label(b), minutes(b), nonce);
      b.sent = { ...(b.sent || {}), [key]: Date.now() };
      return true;
    } catch (err) {
      console.error(`calls/email ${kind} ${b.id}:`, err.message);
      b.fails = { ...(b.fails || {}), [kind]: ((b.fails || {})[kind] || 0) + 1 };
      if (b.fails[kind] >= MAX_TRIES) {
        b.sent = { ...(b.sent || {}), [kind]: 'failed' };
        await toChat(`⚠️ <b>Email not delivered</b> (${kind === 'confirm' ? 'confirmation' : kind === 'day' ? 'day-before reminder' : 'meeting link'})\n${esc(b.name)} · ${esc(b.email)}\n${esc(err.message.slice(0, 200))}`);
      }
      return false;
    }
  }

  async function tick() {
    if (!mailConfigured()) return;
    await withLock(async () => {
      const list = await readStore();
      const now = Date.now();
      let changed = false;
      for (const b of list) {
        if (!b.email || now > b.end) continue;
        const sent = b.sent || {};
        if (!sent.confirm) { await send('confirm', b); changed = true; }
        // day-before reminder (sent 24 h ahead, up to 4 h late after a restart),
        // unless the call was booked less than a day ahead
        if (!sent.day && b.createdAt < b.start - 24 * HOUR && now >= b.start - 24 * HOUR && now < b.start - 20 * HOUR) {
          await send('day', b);
          changed = true;
        }
        if (b.meetLink && !sent.link && now >= b.start - HOUR) { await send('link', b); changed = true; }
        // no link yet: nudge the team at 3 h and again at 75 min before the call
        if (!b.meetLink) {
          const alerts = b.alerts || {};
          for (const [key, before] of [['h3', 3 * HOUR], ['m75', 75 * 60e3]]) {
            if (!alerts[key] && now >= b.start - before) {
              b.alerts = { ...alerts, [key]: now };
              changed = true;
              await toChat(`⏰ <b>No meeting link yet</b>\n${esc(label(b))} with <b>${esc(b.name)}</b> (${esc(b.company)}) at ${esc(hostWhen(b.start))}.\nThe link email goes out 1 hour before - add the link now.`, linkKeyboard(b));
              break;
            }
          }
        }
      }
      if (changed) await writeStore(list);
    });
  }

  let tickTimer = 0;
  const kick = () => { clearTimeout(tickTimer); tickTimer = setTimeout(() => tick().catch((e) => console.error('calls/tick:', e.message)), 300); };
  setInterval(() => tick().catch((e) => console.error('calls/tick:', e.message)), 60e3).unref();
  kick();
  if (!mailConfigured()) console.error('calls: RESEND_API_KEY / RESEND_FROM not set - booking emails are off');

  // ── bot ───────────────────────────────────────────────────────────────
  const pending = new Map(); // telegram user id -> booking id waiting for a link

  async function find(id) {
    return (await readStore()).find((b) => b.id === id);
  }
  async function update(id, fn) {
    return withLock(async () => {
      const list = await readStore();
      const b = list.find((x) => x.id === id);
      if (!b) return null;
      await fn(b);
      await writeStore(list);
      return b;
    });
  }

  function card(b) {
    const s = b.sent || {};
    const st = (k) => (s[k] === 'failed' ? '⚠️ failed' : s[k] ? `✅ ${hostWhen(s[k])}` : '-');
    const w = when(b);
    return [
      `<b>${esc(label(b))}</b> · ${minutes(b)} min`,
      `🗓 ${esc(hostWhen(b.start))}-${esc(hostWhen(b.end, false))} (${esc(hostTz())})`,
      b.tz && b.tz !== hostTz() ? `Guest time: ${esc(w.day)}, ${esc(w.time)} (${esc(w.zone)})` : null,
      `👤 <b>${esc(b.name)}</b> · ${esc(b.company)}`,
      `✉️ ${esc(b.email)}`,
      `🔗 ${b.meetLink ? esc(b.meetLink) : '<i>no link yet</i>'}`,
      '',
      `Emails: confirmation ${st('confirm')} · day before ${b.createdAt < b.start - 24 * HOUR ? st('day') : 'skipped (booked &lt;24h ahead)'} · link 1h before ${st('link')}${s.linkEarly ? ` (also sent early ${hostWhen(s.linkEarly)})` : ''}`,
    ].filter((x) => x !== null).join('\n');
  }
  function cardKeyboard(b) {
    const rows = [[{ text: b.meetLink ? '🔗 Change link' : '🔗 Add link', callback_data: `l:${b.id}` }]];
    if (b.meetLink) rows[0].push({ text: '📨 Send link now', callback_data: `n:${b.id}` });
    rows.push([{ text: '✉️ Resend confirmation', callback_data: `r:${b.id}` }, { text: '⬅️ All calls', callback_data: 'list' }]);
    return { inline_keyboard: rows };
  }

  async function listCalls(chat) {
    const now = Date.now();
    const list = (await readStore()).filter((b) => b.email && b.end > now).sort((a, b) => a.start - b.start).slice(0, 25);
    if (!list.length) return tg('sendMessage', { chat_id: chat, text: 'No upcoming calls.' });
    return tg('sendMessage', {
      chat_id: chat,
      parse_mode: 'HTML',
      text: '<b>Upcoming calls</b>\n🔗 = link added · ⚠️ = no link yet\nTap a call to manage it.',
      reply_markup: { inline_keyboard: list.map((b) => [{ text: `${b.meetLink ? '🔗' : '⚠️'} ${hostWhen(b.start)} · ${b.name}`.slice(0, 60), callback_data: `c:${b.id}` }]) },
    });
  }

  async function askLink(chat, user, b) {
    pending.set(user, b.id);
    return tg('sendMessage', {
      chat_id: chat,
      parse_mode: 'HTML',
      text: `${card(b)}\n\nSend the meeting link for this call (https://...).\n/cancel to stop.`,
      disable_web_page_preview: true,
    });
  }

  async function saveLink(chat, user, text) {
    const id = pending.get(user);
    const url = text.trim();
    if (!isUrl(url) || url.length > 500) return tg('sendMessage', { chat_id: chat, text: 'That does not look like a link. Send a full link starting with https:// or /cancel.' });
    pending.delete(user);
    let resend = false;
    const b = await update(id, async (x) => {
      resend = Boolean(x.sent && x.sent.link && x.meetLink !== url);
      x.meetLink = url;
      if (resend) { x.sent = { ...x.sent, link: undefined }; x.fails = { ...(x.fails || {}), link: 0 }; }
    });
    if (!b) return tg('sendMessage', { chat_id: chat, text: 'This call no longer exists.' });
    const dueNow = Date.now() >= b.start - HOUR;
    kick();
    return tg('sendMessage', {
      chat_id: chat,
      parse_mode: 'HTML',
      text: `✅ Link saved for <b>${esc(b.name)}</b>.\n${dueNow || resend ? 'The email with the link is being sent now.' : `The email with the link goes out at ${esc(hostWhen(b.start - HOUR))} (1 hour before).`}`,
      reply_markup: cardKeyboard(b),
    });
  }

  async function onMessage(m) {
    if (m.chat.type !== 'private') return; // the bot only talks in private chats
    const user = String(m.from.id);
    const text = String(m.text || '').trim();
    if (!ADMINS.has(user)) {
      return tg('sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text: `This bot is private.\nYour Telegram id is <code>${esc(user)}</code> - to get access, it has to be added to TELEGRAM_ADMIN_IDS on the server.` });
    }
    if (text.startsWith('/start link_')) {
      const b = await find(text.slice('/start link_'.length).trim());
      if (!b) return tg('sendMessage', { chat_id: m.chat.id, text: 'This call no longer exists.' });
      return askLink(m.chat.id, user, b);
    }
    if (text === '/cancel') { pending.delete(user); return tg('sendMessage', { chat_id: m.chat.id, text: 'Cancelled.' }); }
    if (text === '/start' || text === '/calls') { pending.delete(user); return listCalls(m.chat.id); }
    if (pending.has(user)) return saveLink(m.chat.id, user, text);
    return tg('sendMessage', { chat_id: m.chat.id, text: 'Use /calls to see upcoming calls and add meeting links.' });
  }

  async function onCallback(q) {
    const user = String(q.from.id);
    const chat = q.message && q.message.chat.id;
    const answer = (text) => tg('answerCallbackQuery', { callback_query_id: q.id, text });
    if (!ADMINS.has(user) || !chat) return answer('Not allowed');
    const [act, id] = String(q.data || '').split(':');
    if (act === 'list') { await answer(); return listCalls(chat); }
    const b = await find(id);
    if (!b) return answer('This call no longer exists');
    if (act === 'c') { await answer(); return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: card(b), reply_markup: cardKeyboard(b), disable_web_page_preview: true }); }
    if (act === 'l') { await answer(); return askLink(chat, user, b); }
    if (act === 'n' || act === 'r') {
      const kind = act === 'n' ? 'link' : 'confirm';
      if (kind === 'link' && !b.meetLink) return answer('Add the link first');
      let ok = false;
      const early = kind === 'link' && Date.now() < b.start - HOUR;
      await update(id, async (x) => { ok = await send(kind, x, String(Date.now()), early ? 'linkEarly' : kind); });
      await answer(ok ? 'Sent' : 'Sending failed');
      return tg('sendMessage', { chat_id: chat, text: ok ? `✅ ${kind === 'link' ? 'Link email' : 'Confirmation'} sent to ${b.email}.${early ? ' The 1-hour reminder with the link will still go out.' : ''}` : '⚠️ Sending failed, see the server log.' });
    }
    return answer();
  }

  async function poll() {
    if (!TOKEN) return;
    const me = await tg('getMe', {});
    botName = me && me.ok ? me.result.username : '';
    await tg('setMyCommands', { commands: [{ command: 'calls', description: 'Upcoming calls and meeting links' }, { command: 'cancel', description: 'Cancel adding a link' }] });
    let offset = 0;
    let warned = false;
    for (;;) {
      const r = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] });
      if (!r || !r.ok) {
        if (r && r.error_code === 409 && !warned) {
          warned = true;
          console.error('calls/bot: another webhook or process is reading this bot\'s updates - the link bot is off until that stops');
        }
        await new Promise((res) => setTimeout(res, r && r.error_code === 409 ? 60e3 : 5e3));
        continue;
      }
      for (const u of r.result) {
        offset = u.update_id + 1;
        try {
          if (u.message) await onMessage(u.message);
          else if (u.callback_query) await onCallback(u.callback_query);
        } catch (err) {
          console.error('calls/bot update:', err.message);
        }
      }
    }
  }
  poll();

  // booking notice for the team chat, with the "Add meeting link" button
  async function notifyBooking(text, b) {
    const r = await toChat(text, linkKeyboard(b));
    return Boolean(r && r.ok);
  }

  return { kick, notifyBooking };
}
