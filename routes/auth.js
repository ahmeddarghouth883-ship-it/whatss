/**
 * /api/auth — email/password + Google OAuth + email verification + password reset.
 * Emails go out through helpers/email.js (Brevo HTTPS by default, SMTP fallback,
 * or console-only in dev when nothing is configured).
 */

const crypto = require('crypto');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { authenticate, generateToken } = require('../helpers/auth');
const {
  sendPasswordResetCodeEmail,
  sendPasswordResetSuccessEmail,
  sendVerificationEmail,
  sendAccountRegisteredEmail,
} = require('../helpers/email');

const router = express.Router();

function randomPassword() {
  return crypto.randomBytes(32).toString('hex');
}

function sixDigitCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
}

router.post('/register', async (req, res) => {
  try {
    const name     = String(req.body?.name     || '').trim();
    const email    = String(req.body?.email    || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const user = await User.create({
      name, email, password,
      emailVerified: true,
      credits: 0,
    });

    // Grant the Free Trial 20-credit signup bonus through the wallet so the
    // transaction log records balanceAfter (idempotent on user._id).
    try {
      const wallet = require('../helpers/wallet');
      await wallet.topup({
        userId:      user._id,
        credits:     20,
        source:      'signup_bonus',
        type:        'bonus',
        reference:   `signup:${user._id}`,
        description: 'Free Trial — 20 credits granted on signup',
      });
    } catch (e) { console.warn('[register] signup bonus failed:', e.message); }

    // Fire-and-forget welcome email (do not block account creation if it fails)
    sendAccountRegisteredEmail({ to: user.email, name: user.name }).catch(() => {});

    const fresh = await User.findById(user._id);
    const token = generateToken(fresh._id);
    return res.status(201).json({ token, user: fresh.toPublic(), message: 'Account created' });
  } catch (err) {
    console.error('[auth/register]', err.message);
    return res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const email    = String(req.body?.email    || '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await User.findOne({ email });
    if (!user || !user.password) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.isActive) return res.status(403).json({ error: 'Account suspended' });

    user.lastLogin = new Date();
    await user.save();

    const token = generateToken(user._id);
    return res.json({ token, user: user.toPublic() });
  } catch (err) {
    console.error('[auth/login]', err.message);
    return res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * Google Identity Services — verify ID token and issue JWT.
 * GOOGLE_CLIENT_ID must match the frontend VITE_GOOGLE_CLIENT_ID.
 */
router.post('/google', async (req, res) => {
  try {
    const credential = String(req.body?.credential || '').trim();
    if (!credential) return res.status(400).json({ error: 'credential is required' });

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({
        error: 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID or add VITE_GOOGLE_CLIENT_ID in frontend/.env.local.',
      });
    }

    const client = new OAuth2Client(clientId);
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload();
    } catch (e) {
      console.error('[auth/google] verifyIdToken:', e.message);
      return res.status(401).json({ error: 'Invalid Google credential' });
    }

    const sub = String(payload.sub || '');
    const email = String(payload.email || '').trim().toLowerCase();
    const name = String(payload.name || '').trim() || (email ? email.split('@')[0] : 'User');

    if (!sub) return res.status(400).json({ error: 'Google token missing subject' });

    let user = await User.findOne({ $or: [{ googleId: sub }, ...(email ? [{ email }] : [])] });

    let isNewUser = false;
    if (!user) {
      if (!email) return res.status(400).json({ error: 'Google account has no email; cannot register' });
      user = await User.create({
        name,
        email,
        password: randomPassword(),
        googleId: sub,
        emailVerified: true,
        avatar: payload.picture || null,
        credits: 0,
      });
      isNewUser = true;
    } else {
      if (!user.googleId) user.googleId = sub;
      if (payload.picture && !user.avatar) user.avatar = payload.picture;
      if (name && user.name !== name) user.name = name;
      user.lastLogin = new Date();
      await user.save();
    }

    if (isNewUser) {
      try {
        const wallet = require('../helpers/wallet');
        await wallet.topup({
          userId:      user._id,
          credits:     20,
          source:      'signup_bonus',
          type:        'bonus',
          reference:   `signup:${user._id}`,
          description: 'Free Trial — 20 credits granted on signup',
        });
      } catch (e) { console.warn('[google] signup bonus failed:', e.message); }
    }

    const token = generateToken(user._id);
    const fresh = await User.findById(user._id);
    return res.json({ token, user: fresh.toPublic() });
  } catch (err) {
    console.error('[auth/google]', err.message);
    return res.status(500).json({ error: 'Google sign-in failed' });
  }
});

/** Email verification — accepts code when it matches DB, or any 6 digits if no code was stored (local dev). */
router.post('/verify-email-code', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    if (!email || code.length !== 6) {
      return res.status(400).json({ error: 'Valid email and 6-digit code are required' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.emailVerificationCode && user.emailVerificationCode !== code) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    user.emailVerified = true;
    user.emailVerificationCode = null;
    user.emailVerificationCodeExpires = null;
    await user.save();

    const token = generateToken(user._id);
    const fresh = await User.findById(user._id);
    return res.json({ token, user: fresh.toPublic(), message: 'Email verified' });
  } catch (err) {
    console.error('[auth/verify-email-code]', err.message);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

/** Generate a fresh code, store it on the user, email it. */
router.post('/resend-verification-code', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Valid email is required' });

    const user = await User.findOne({ email });
    if (!user) {
      // Do not leak whether the email exists
      return res.json({ message: 'If an account exists, a verification code was sent.' });
    }

    const code = sixDigitCode();
    user.emailVerificationCode = code;
    user.emailVerificationCodeExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    const verifyUrl = `${(req.headers.origin || '').replace(/\/$/, '')}/verify-email?email=${encodeURIComponent(email)}&code=${code}`;
    sendVerificationEmail({
      to: email,
      name: user.name,
      verifyUrl: req.headers.origin ? verifyUrl : null,
      verificationCode: code,
    }).catch((e) => console.warn('[auth/resend-verification-code] mail err:', e.message));

    return res.json({ message: 'Verification code sent. Check your inbox.' });
  } catch (err) {
    console.error('[auth/resend-verification-code]', err.message);
    return res.status(500).json({ error: 'Failed to send verification code' });
  }
});

/** Generate a 6-digit reset code, persist + email it. */
router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Valid email is required' });

    const user = await User.findOne({ email });
    // Always reply 200 with neutral message — no enumeration
    if (!user) {
      return res.json({ message: 'If an account exists for that email, a reset code was sent.' });
    }

    const code = sixDigitCode();
    user.passwordResetCode = code;
    user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    await user.save();

    sendPasswordResetCodeEmail({ to: email, name: user.name, code })
      .catch((e) => console.warn('[auth/forgot-password] mail err:', e.message));

    return res.json({ message: 'If an account exists for that email, a reset code was sent.' });
  } catch (err) {
    console.error('[auth/forgot-password]', err.message);
    return res.status(500).json({ error: 'Failed to start password reset' });
  }
});

/** Verify the reset code, change the password, send confirmation. */
router.post('/reset-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const newPassword = String(req.body?.newPassword || req.body?.password || '');

    if (!isValidEmail(email)) return res.status(400).json({ error: 'Valid email is required' });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: '6-digit code is required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const user = await User.findOne({ email });
    if (!user || !user.passwordResetCode || !user.passwordResetExpires) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }
    if (user.passwordResetExpires.getTime() < Date.now()) {
      return res.status(400).json({ error: 'Reset code expired — request a new one' });
    }
    if (user.passwordResetCode !== code) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    user.password = newPassword;        // pre-save hook hashes it
    user.passwordResetCode = null;
    user.passwordResetExpires = null;
    await user.save();

    sendPasswordResetSuccessEmail({ to: email, name: user.name })
      .catch((e) => console.warn('[auth/reset-password] confirm mail err:', e.message));

    const token = generateToken(user._id);
    return res.json({ message: 'Password reset successful', token, user: user.toPublic() });
  } catch (err) {
    console.error('[auth/reset-password]', err.message);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  return res.json({ user: req.user.toPublic ? req.user.toPublic() : req.user });
});

module.exports = router;
