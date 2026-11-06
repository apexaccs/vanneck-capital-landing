import express from 'express';
import 'dotenv/config';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;

const ROLES = ['trader', 'builder', 'founder', 'creator', 'other'];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

function bad(res, field, error) {
  return res.status(400).json({ ok: false, field, error });
}

// Every submission must reach the Telegram chat: one retry on network errors,
// timeouts, 429 and 5xx. Returns true only when Telegram accepted the message.
async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('telegram: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set');
    return false;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) return true;
      lastErr = `status ${r.status} ${await r.text()}`;
      if (r.status < 500 && r.status !== 429) break;
    } catch (err) {
      lastErr = err.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  console.error('telegram: delivery failed:', lastErr);
  return false;
}

app.post('/api/apply', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.website) return res.json({ ok: true }); // honeypot tripped - pretend success

    const name = clean(body.name);
    const email = clean(body.email);
    const project = clean(body.project);
    const link = clean(body.link);
    const message = clean(body.message);

    if (name.length < 2 || name.length > 100) return bad(res, 'name', 'Please enter your name');
    if (!isValidEmail(email)) return bad(res, 'email', 'Please enter a valid email');
    if (project.length < 2 || project.length > 200) return bad(res, 'project', 'Please tell us the project name');
    if (link && (link.length > 300 || !isHttpUrl(link))) return bad(res, 'link', 'Please enter a valid link');
    if (message.length > 2000) return bad(res, 'message', 'Message is too long');

    const text =
      `<b>New application</b>\n` +
      `<b>Name:</b> ${escapeHtml(name)}\n` +
      `<b>Email:</b> ${escapeHtml(email)}\n` +
      `<b>Project:</b> ${escapeHtml(project)}\n` +
      `<b>Link:</b> ${escapeHtml(link || '-')}\n\n` +
      `${escapeHtml(message || '(no message)')}`;

    if (!(await sendTelegram(text))) {
      return res.status(502).json({ ok: false, error: 'Delivery failed' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('apply: unexpected error', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.post('/api/newsletter', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.website) return res.json({ ok: true }); // honeypot tripped - pretend success

    const email = clean(body.email);
    if (!isValidEmail(email)) return bad(res, 'email', 'Please enter a valid email');

    // Telegram notification and Resend audience run in parallel; the signup
    // counts as received if at least one of them succeeded.
    const [tgOk, resendOk] = await Promise.all([
      sendTelegram(`<b>New newsletter signup</b>\n<b>Email:</b> ${escapeHtml(email)}`),
      addToResendAudience(email),
    ]);
    if (!tgOk && !resendOk) {
      return res.status(502).json({ ok: false, error: 'Subscription failed' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('newsletter: unexpected error', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

async function addToResendAudience(email) {
  if (!RESEND_API_KEY || !RESEND_AUDIENCE_ID) {
    console.error('newsletter: RESEND_API_KEY/RESEND_AUDIENCE_ID not set');
    return false;
  }
  try {
    const rRes = await fetch(`https://api.resend.com/audiences/${RESEND_AUDIENCE_ID}/contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({ email, unsubscribed: false }),
      signal: AbortSignal.timeout(10000),
    });
    if (rRes.ok) return true;
    const text = await rRes.text();
    // duplicates count as success
    if (rRes.status === 409 || /already exists/i.test(text)) return true;
    console.error('newsletter: resend error', rRes.status, text);
    return false;
  } catch (err) {
    console.error('newsletter: resend request failed', err.message);
    return false;
  }
}

app.post('/api/protection', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.website) return res.json({ ok: true }); // honeypot tripped - pretend success

    const contact = clean(body.contact);
    const email = clean(body.email);
    const role = clean(body.role);
    const need = clean(body.need);

    if (contact.length < 3 || contact.length > 100 || !/[a-z0-9]{2,}/i.test(contact)) {
      return bad(res, 'contact', 'Please enter your X handle or Telegram');
    }
    if (!isValidEmail(email)) return bad(res, 'email', 'Please enter a valid email');
    if (!ROLES.includes(role)) return bad(res, 'role', 'Please select your role');
    if (need.length > 1000) return bad(res, 'need', 'Text is too long');
    if (body.agree !== true) return bad(res, 'agree', 'Please confirm to continue');

    const text =
      `<b>New Sophos protection application</b>\n` +
      `<b>Contact:</b> ${escapeHtml(contact)}\n` +
      `<b>Email:</b> ${escapeHtml(email)}\n` +
      `<b>Role:</b> ${escapeHtml(role)}\n` +
      `<b>What for:</b> ${escapeHtml(need || '(not given)')}`;

    if (!(await sendTelegram(text))) {
      return res.status(502).json({ ok: false, error: 'Delivery failed' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('protection: unexpected error', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`vanneck-backend listening on 127.0.0.1:${PORT}`);
});
