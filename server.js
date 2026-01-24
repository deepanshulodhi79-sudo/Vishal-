// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// 🔑 Hardcoded login
const HARD_USERNAME = "JAI SHREE RAAM";
const HARD_PASSWORD = "JAI SHREE RAAM";

// ================= LIMITS (SAFE) =================
const HOURLY_LIMIT = 24;   // thoda kam = spam kam
const DAILY_LIMIT  = 80;   // daily cap
let stats = {};            // per-sender stats

// ================= MIDDLEWARE =================
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'bulk-mailer-secret',
  resave: false,
  saveUninitialized: true
}));

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/');
}

// ================= ROUTES =================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === HARD_USERNAME && password === HARD_PASSWORD) {
    req.session.user = username;
    return res.json({ success: true });
  }
  return res.json({ success: false });
});

app.get('/launcher', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// ================= HELPERS =================
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
// micro-jitter (average fast)
function smartDelay() {
  return delay(120 + Math.floor(Math.random() * 140)); // 120–260ms
}

async function sendBatch(transporter, mails, batchSize = 3) {
  for (let i = 0; i < mails.length; i += batchSize) {
    await Promise.allSettled(
      mails.slice(i, i + batchSize).map(m => transporter.sendMail(m))
    );
    await smartDelay();
  }
}

// ================= SEND MAIL =================
app.post('/send', requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } = req.body;
    if (!email || !password || !recipients) {
      return res.json({ success: false, message: "Email, password and recipients required" });
    }

    // init stats
    const now = Date.now();
    if (!stats[email]) stats[email] = { h: 0, d: 0, hs: now, ds: now };
    if (now - stats[email].hs > 60 * 60 * 1000) { stats[email].h = 0; stats[email].hs = now; }
    if (now - stats[email].ds > 24 * 60 * 60 * 1000) { stats[email].d = 0; stats[email].ds = now; }

    const list = recipients.split(/[\n,]+/).map(r => r.trim()).filter(Boolean);
    if (!list.length) return res.json({ success: false, message: "No valid recipients" });

    if (stats[email].h + list.length > HOURLY_LIMIT ||
        stats[email].d + list.length > DAILY_LIMIT) {
      return res.json({ success: false, message: "Sending limit reached" });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    // boring subject = better
    const finalSubject = (subject && subject.trim()) ? subject : "Quick question";

    const mails = list.map(to => ({
      from: `"${senderName && senderName.trim() ? senderName : email.split('@')[0]}" <${email}>`,
      to,
      subject: finalSubject,
      // ❌ no auto greeting
      // ❌ no fake headers
      // ❌ plain text only
      text: message || ""
    }));

    await sendBatch(transporter, mails, 3);
    stats[email].h += list.length;
    stats[email].d += list.length;

    return res.json({ success: true, message: `Sent ${list.length}` });
  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

// ================= START =================
app.listen(PORT, () => {
  console.log(`🚀 Mail Launcher running on port ${PORT}`);
});
