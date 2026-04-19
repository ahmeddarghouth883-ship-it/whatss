/**
 * Ensures a test admin account exists for local development.
 *
 * - Runs when NODE_ENV !== 'production' OR SEED_ADMIN=1
 * - Skipped when SEED_ADMIN=0
 *
 * Defaults (override with ADMIN_EMAIL / ADMIN_PASSWORD in .env or env/logs):
 *   Email:    admin@whispflow.local
 *   Password: Admin123456!
 *
 * Other accounts with role admin are demoted to user so only this email stays
 * admin, unless ALLOW_MULTIPLE_ADMINS=1.
 */

const User = require('../models/User');

async function seedAdminUser() {
  if (process.env.SEED_ADMIN === '0') return;

  const allow =
    process.env.NODE_ENV !== 'production' || process.env.SEED_ADMIN === '1';
  if (!allow) return;

  const email = String(process.env.ADMIN_EMAIL || 'admin@whispflow.local')
    .trim()
    .toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || 'Admin123456!');
  const name = String(process.env.ADMIN_NAME || 'Admin').trim() || 'Admin';

  if (password.length < 6) {
    console.warn('[seedAdmin] ADMIN_PASSWORD too short — skipping admin seed');
    return;
  }

  let user = await User.findOne({ email });
  if (!user) {
    await User.create({
      name,
      email,
      password,
      role: 'admin',
      emailVerified: true,
    });
    console.log(`[seedAdmin] Created admin — ${email} (password: set in env or default)`);
  } else if (user.role !== 'admin') {
    user.role = 'admin';
    await user.save();
    console.log(`[seedAdmin] Promoted existing user to admin — ${email}`);
  } else {
    console.log(`[seedAdmin] Admin already present — ${email}`);
  }

  // One canonical admin: demote any other accounts that still have role admin.
  if (process.env.ALLOW_MULTIPLE_ADMINS === '1') return;

  const res = await User.updateMany(
    { role: 'admin', email: { $ne: email } },
    { $set: { role: 'user' } }
  );
  if (res.modifiedCount > 0) {
    console.log(
      `[seedAdmin] Demoted ${res.modifiedCount} other user(s) from admin — only ${email} remains admin`
    );
  }
}

module.exports = { seedAdminUser };
