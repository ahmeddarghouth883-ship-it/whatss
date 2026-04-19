/**
 * One-shot: connect, drop the whole database, seed one admin + plans, exit.
 * Usage (repo root): node scripts/resetMongo.js
 *
 * Production wipe: set ALLOW_RESET_DB_IN_PRODUCTION=1
 */

const { loadEnvLogs } = require('../helpers/envLoader');
loadEnvLogs();

const mongoose = require('mongoose');
const connectDB = require('../helpers/database');
const { resetDatabase } = require('../helpers/resetDatabase');
const { seedAdminUser } = require('../helpers/seedAdmin');
const { seedPlans } = require('../helpers/seedPlans');

(async () => {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && process.env.ALLOW_RESET_DB_IN_PRODUCTION !== '1') {
      console.error(
        'Refusing to drop database in production. Set ALLOW_RESET_DB_IN_PRODUCTION=1 if you really mean it.'
      );
      process.exit(1);
    }

    await connectDB();
    await resetDatabase();
    await seedAdminUser();
    await seedPlans();
    console.log('✅ Reset complete: empty DB, one admin, plans seeded.');
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error(err);
    try {
      await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
  }
})();
