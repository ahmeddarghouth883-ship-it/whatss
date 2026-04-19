/**
 * helpers/email.js — multi-provider email sender.
 *
 * Picks the provider via EMAIL_PROVIDER:
 *   - "brevo" (default when BREVO_API_KEY is set) → POST https://api.brevo.com/v3/smtp/email
 *   - "smtp"  (or fallback when SMTP_USER+SMTP_PASS set) → nodemailer SMTP
 *   - none configured → logs to console (dev fallback) so the auth flow still works.
 *
 * Exports:
 *   sendVerificationEmail({ to, name, verifyUrl, verificationCode })
 *   sendPasswordResetCodeEmail({ to, name, code })
 *   sendAccountRegisteredEmail({ to, name })
 *   sendPasswordResetSuccessEmail({ to, name })
 *   sendGeneric({ to, subject, html, text })
 */

const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BRAND = 'WhispFlow';

// ── Provider selection ───────────────────────────────────────────────────────

function pickProvider() {
  const explicit = String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'brevo' || explicit === 'sendinblue') return 'brevo';
  if (explicit === 'smtp') return 'smtp';
  if (process.env.BREVO_API_KEY) return 'brevo';
  if (process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return 'none';
}

// ── Sender parsing ───────────────────────────────────────────────────────────
// Accepts "Name <email@domain>" or just "email@domain"
function parseFrom(raw) {
  const fallback = process.env.SMTP_USER || 'no-reply@whispflow.local';
  const value = String(raw || process.env.EMAIL_FROM || process.env.SMTP_FROM || fallback).trim();
  const m = value.match(/^\s*(.+?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) return { name: m[1].replace(/^['"]|['"]$/g, ''), email: m[2].trim() };
  return { name: BRAND, email: value };
}

// ── Brevo HTTPS transport ────────────────────────────────────────────────────

async function brevoSend({ to, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY missing');

  const sender = parseFrom();
  const payload = {
    sender: { name: sender.name, email: sender.email },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    ...(text ? { textContent: text } : {}),
  };

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, providerMessageId: data.messageId || null };
}

// ── SMTP transport (legacy) ──────────────────────────────────────────────────

let cachedTransporter = null;
let cachedTransportKey = '';

function createTransporter() {
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').replace(/\s+/g, '');
  const host = String(process.env.SMTP_HOST || '').trim() || (user.endsWith('@gmail.com') ? 'smtp.gmail.com' : '');
  const port = Number(process.env.SMTP_PORT || 587);

  if (!host || !user || !pass) return null;

  const key = `${host}|${port}|${user}`;
  if (cachedTransporter && cachedTransportKey === key) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host, port, secure: port === 465,
    pool: true, maxConnections: 3, maxMessages: 100,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    auth: { user, pass },
  });
  cachedTransportKey = key;
  return cachedTransporter;
}

async function smtpSend({ to, subject, html, text }) {
  const transporter = createTransporter();
  if (!transporter) throw new Error('SMTP not configured');

  const sender = parseFrom();
  const from = sender.name ? `${sender.name} <${sender.email}>` : sender.email;
  await transporter.sendMail({ from, to, subject, html, text });
  return { ok: true, providerMessageId: null };
}

// ── Unified send ─────────────────────────────────────────────────────────────

async function sendGeneric({ to, subject, html, text, label }) {
  if (!to) throw new Error('sendGeneric: "to" is required');
  if (!subject) throw new Error('sendGeneric: "subject" is required');

  const provider = pickProvider();
  const tag = label || subject;

  try {
    if (provider === 'brevo') {
      const r = await brevoSend({ to, subject, html, text });
      console.log(`[email/${tag}] sent via brevo to ${to}`);
      return { sent: true, provider: 'brevo', ...r };
    }
    if (provider === 'smtp') {
      const r = await smtpSend({ to, subject, html, text });
      console.log(`[email/${tag}] sent via smtp to ${to}`);
      return { sent: true, provider: 'smtp', ...r };
    }
    console.warn(`[email/${tag}] no email provider configured — logged to console only.`);
    console.log(`[email/${tag}] to: ${to}\nsubject: ${subject}\n${text || stripHtml(html)}`);
    return { sent: false, skipped: true, provider: 'none' };
  } catch (err) {
    console.error(`[email/${tag}] send failed (${provider}):`, err.message);
    // Never throw to callers — auth flows must remain usable
    return { sent: false, error: err.message, provider };
  }
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// ── Templated wrappers ──────────────────────────────────────────────────────

function wrap(content) {
  return `
    <div style="background:#f6f7f9;padding:24px 0;font-family:Arial,sans-serif">
      <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;color:#111">
        <div style="font-family:Georgia,serif;font-size:22px;color:#16a34a;margin-bottom:16px">WhispFlow</div>
        ${content}
        <hr style="border:none;border-top:1px solid #f1f5f9;margin:28px 0 12px"/>
        <p style="font-size:12px;color:#9ca3af;margin:0">Sent automatically by WhispFlow.</p>
      </div>
    </div>
  `;
}

async function sendVerificationEmail({ to, name, verifyUrl, verificationCode }) {
  const codeBlock = verificationCode
    ? `<p style="margin:18px 0 6px;color:#374151">Or enter this code in the app:</p>
       <p style="font-size:28px;letter-spacing:6px;font-weight:700;margin:0 0 18px;color:#16a34a;font-family:'Courier New',monospace">${verificationCode}</p>`
    : '';
  const button = verifyUrl
    ? `<p style="margin:18px 0">
         <a href="${verifyUrl}" style="display:inline-block;padding:12px 22px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Verify Email</a>
       </p>
       <p style="font-size:13px;color:#6b7280">If the button does not work, open this link:<br/><a href="${verifyUrl}" style="color:#2563eb;word-break:break-all">${verifyUrl}</a></p>`
    : '';

  const html = wrap(`
    <h2 style="margin:0 0 12px;font-size:20px">Verify your email</h2>
    <p style="margin:0 0 6px;color:#374151">Hello ${escapeHtml(name) || 'there'},</p>
    <p style="margin:0 0 12px;color:#374151">Please confirm your email address to activate your WhispFlow account.</p>
    ${codeBlock}
    ${button}
    <p style="font-size:12px;color:#9ca3af;margin-top:18px">This code expires in 24 hours.</p>
  `);

  const text = `Hi ${name || ''}, verify your WhispFlow email.${verificationCode ? ` Code: ${verificationCode}.` : ''}${verifyUrl ? ` Link: ${verifyUrl}` : ''}`;

  return sendGeneric({ to, subject: 'Verify your WhispFlow account', html, text, label: 'verify' });
}

async function sendPasswordResetCodeEmail({ to, name, code }) {
  const html = wrap(`
    <h2 style="margin:0 0 12px;font-size:20px">Reset your password</h2>
    <p style="margin:0 0 6px;color:#374151">Hello ${escapeHtml(name) || 'there'},</p>
    <p style="margin:0 0 14px;color:#374151">Use this verification code to reset your WhispFlow password:</p>
    <p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:0 0 18px;color:#16a34a;font-family:'Courier New',monospace">${code}</p>
    <p style="font-size:13px;color:#6b7280">This code expires in 15 minutes. If you did not request a reset, ignore this email.</p>
  `);
  const text = `Your WhispFlow password reset code is ${code}. It expires in 15 minutes.`;
  return sendGeneric({ to, subject: 'Your WhispFlow password reset code', html, text, label: 'reset-code' });
}

async function sendAccountRegisteredEmail({ to, name }) {
  const html = wrap(`
    <h2 style="margin:0 0 12px;font-size:20px">Welcome to WhispFlow</h2>
    <p style="margin:0 0 6px;color:#374151">Hello ${escapeHtml(name) || 'there'},</p>
    <p style="margin:0 0 14px;color:#374151">Your account is ready. You now have <b>20 free credits</b> to extract leads or send messages.</p>
    <p><a href="https://whispflow.software/login" style="display:inline-block;padding:10px 18px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Open WhispFlow</a></p>
  `);
  const text = `Welcome to WhispFlow, ${name || ''}. Your account is ready.`;
  return sendGeneric({ to, subject: 'Welcome to WhispFlow', html, text, label: 'welcome' });
}

async function sendPasswordResetSuccessEmail({ to, name }) {
  const html = wrap(`
    <h2 style="margin:0 0 12px;font-size:20px">Your password was changed</h2>
    <p style="margin:0 0 6px;color:#374151">Hello ${escapeHtml(name) || 'there'},</p>
    <p style="margin:0 0 14px;color:#374151">Your WhispFlow password has been reset successfully.</p>
    <p style="color:#dc2626;font-size:13px">If you did not perform this change, secure your account immediately by resetting your password again.</p>
  `);
  const text = `Hello ${name || ''}, your WhispFlow password has been reset successfully.`;
  return sendGeneric({ to, subject: 'WhispFlow password reset successful', html, text, label: 'reset-ok' });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = {
  sendGeneric,
  sendVerificationEmail,
  sendPasswordResetCodeEmail,
  sendAccountRegisteredEmail,
  sendPasswordResetSuccessEmail,
  // Convenience aliases used by routes/auth.js (new wiring)
  sendPasswordResetCode: sendPasswordResetCodeEmail,
  sendVerificationCode:  sendVerificationEmail,
  pickProvider,
};
