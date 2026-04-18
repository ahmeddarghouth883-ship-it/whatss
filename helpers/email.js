const nodemailer = require('nodemailer');
const path = require('path');

// Load project root .env even if the server/process was launched from another cwd.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

let cachedTransporter = null;
let cachedTransportKey = '';

function getTransportKey(host, port, user) {
  return `${host}|${port}|${user}`;
}

function createTransporter() {
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').replace(/\s+/g, '');
  const host = String(process.env.SMTP_HOST || '').trim() || (user.endsWith('@gmail.com') ? 'smtp.gmail.com' : '');
  const port = Number(process.env.SMTP_PORT || 587);

  if (!host || !user || !pass) {
    const missing = [
      !host ? 'SMTP_HOST' : null,
      !user ? 'SMTP_USER' : null,
      !pass ? 'SMTP_PASS' : null
    ].filter(Boolean).join(', ');
    console.warn('[email] SMTP config missing:', missing);
    return null;
  }

  const key = getTransportKey(host, port, user);
  if (cachedTransporter && cachedTransportKey === key) {
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    auth: { user, pass }
  });

  cachedTransportKey = key;
  return cachedTransporter;
}

async function sendVerificationEmail({ to, name, verifyUrl, verificationCode }) {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@whispflow.local';

  if (!transporter) {
    console.log('[email/verify] SMTP not configured. Verification URL:', verifyUrl);
    return { sent: false, skipped: true };
  }

  const codeHtml = verificationCode
    ? `<p>Or use this verification code in the app:</p>
      <p style="font-size:28px;letter-spacing:4px;font-weight:700;margin:16px 0;color:#16a34a">${verificationCode}</p>`
    : '';

  const textCode = verificationCode
    ? `\nVerification code: ${verificationCode}`
    : '';

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <h2>Verify your WhispFlow account</h2>
      <p>Hello ${name || ''},</p>
      <p>Please verify your email address by clicking the button below:</p>
      <p>
        <a href="${verifyUrl}" style="display:inline-block;padding:10px 16px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px">
          Verify Email
        </a>
      </p>
      ${codeHtml}
      <p>If the button does not work, open this link:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link expires in 24 hours.</p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to,
    subject: 'Verify your WhispFlow account',
    text: `Verify your account: ${verifyUrl}${textCode}`,
    html
  });

  return { sent: true, skipped: false };
}

async function sendPasswordResetCodeEmail({ to, name, code }) {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@whispflow.local';

  if (!transporter) {
    console.log('[email/reset-code] SMTP not configured. Reset code:', code, 'for', to);
    return { sent: false, skipped: true };
  }

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <h2>Reset your WhispFlow password</h2>
      <p>Hello ${name || ''},</p>
      <p>Use this verification code to reset your password:</p>
      <p style="font-size:28px;letter-spacing:4px;font-weight:700;margin:16px 0;color:#16a34a">${code}</p>
      <p>This code expires in 15 minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to,
    subject: 'Your WhispFlow password reset code',
    text: `Your WhispFlow password reset code is ${code}. It expires in 15 minutes.`,
    html
  });

  return { sent: true, skipped: false };
}

async function sendAccountRegisteredEmail({ to, name }) {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@whispflow.local';

  if (!transporter) {
    console.log('[email/account-registered] SMTP not configured for', to);
    return { sent: false, skipped: true };
  }

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <h2>Your WhispFlow account is registered</h2>
      <p>Hello ${name || ''},</p>
      <p>Your account has been successfully registered and verified.</p>
      <p>You can now log in and start using WhispFlow.</p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to,
    subject: 'WhispFlow account registered successfully',
    text: `Hello ${name || ''}, your WhispFlow account has been registered successfully.`,
    html
  });

  return { sent: true, skipped: false };
}

async function sendPasswordResetSuccessEmail({ to, name }) {
  const transporter = createTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@whispflow.local';

  if (!transporter) {
    console.log('[email/reset-success] SMTP not configured for', to);
    return { sent: false, skipped: true };
  }

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <h2>Your password was changed</h2>
      <p>Hello ${name || ''},</p>
      <p>Your WhispFlow account password has been reset successfully.</p>
      <p>If you did not do this, please secure your account immediately.</p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to,
    subject: 'WhispFlow password reset successful',
    text: `Hello ${name || ''}, your WhispFlow password has been reset successfully.`,
    html
  });

  return { sent: true, skipped: false };
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetCodeEmail,
  sendAccountRegisteredEmail,
  sendPasswordResetSuccessEmail
};
