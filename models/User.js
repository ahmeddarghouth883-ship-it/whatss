const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  googleId: { type: String, unique: true, sparse: true },
  password: { type: String, required: true, minlength: 6 },
  role:     { type: String, enum: ['user', 'admin'], default: 'user' },
  plan:     { type: String, enum: ['free', 'starter', 'pro', 'agency'], default: 'free' },
  credits:  { type: Number, default: 50 },
  wallet:   { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  avatar:   { type: String, default: null },
  phone:    { type: String, default: null },
  company:  { type: String, default: null },
  emailVerified: { type: Boolean, default: false },
  emailVerificationToken: { type: String, default: null, index: true },
  emailVerificationExpires: { type: Date, default: null },
  emailVerificationCode: { type: String, default: null, index: true },
  emailVerificationCodeExpires: { type: Date, default: null },
  passwordResetCode: { type: String, default: null, index: true },
  passwordResetExpires: { type: Date, default: null },
  timezone: { type: String, default: 'Africa/Tunis' },
  lastLogin:{ type: Date },
  createdAt:{ type: Date, default: Date.now }
});

// Hash password before save
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

UserSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

UserSchema.methods.toPublic = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', UserSchema);
