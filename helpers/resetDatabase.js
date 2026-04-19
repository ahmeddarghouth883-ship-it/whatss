/**
 * Drops the current MongoDB database (all collections). Use only after connectDB().
 */

const mongoose = require('mongoose');

async function resetDatabase() {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('resetDatabase: mongoose is not connected');
  }
  await db.dropDatabase();
  console.log('🗑️  MongoDB database dropped — all data cleared.');
}

module.exports = { resetDatabase };
