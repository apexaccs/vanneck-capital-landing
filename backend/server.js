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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length < 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.post('/api/apply', async (req, res) => {
  try {
    const { name, email, project, link, message, website } = req.body || {};
    if (website) return res.json({ ok: true }); // honeypot tripped - pretend success

    if (!name || !email || !project || !isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Missing or invalid fields' });
    }
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.error('apply: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set');
      return res.status(500).json({ ok: false, error: 'Server not configured' });
    }

    const text =
      `<b>New application</b>\n` +
      `<b>Name:</b> ${escapeHtml(name)}\n` +
      `<b>Email:</b> ${escapeHtml(email)}\n` +
      `<b>Project:</b> ${escapeHtml(project)}\n` +
      `<b>Link:</b> ${escapeHtml(link || '-')}\n\n` +
      `${escapeHtml(message || '(no message)')}`;

    const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    });
    if (!tgRes.ok) {
      console.error('apply: telegram error', tgRes.status, await tgRes.text());
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
    const { email, website } = req.body || {};
    if (website) return res.json({ ok: true }); // honeypot tripped - pretend success

    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email' });
    }
    if (!RESEND_API_KEY || !RESEND_AUDIENCE_ID) {
      console.error('newsletter: RESEND_API_KEY/RESEND_AUDIENCE_ID not set');
      return res.status(500).json({ ok: false, error: 'Server not configured' });
    }

    const rRes = await fetch(`https://api.resend.com/audiences/${RESEND_AUDIENCE_ID}/contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({ email, unsubscribed: false }),
    });
    // Resend returns 409-ish behavior for duplicates depending on version;
    // treat "already exists" as success rather than surfacing an error.
    if (!rRes.ok) {
      const body = await rRes.text();
      if (rRes.status === 409 || /already exists/i.test(body)) {
        return res.json({ ok: true });
      }
      console.error('newsletter: resend error', rRes.status, body);
      return res.status(502).json({ ok: false, error: 'Subscription failed' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('newsletter: unexpected error', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`vanneck-backend listening on 127.0.0.1:${PORT}`);
});
