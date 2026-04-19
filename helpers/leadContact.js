const Lead = require('../models/Lead');
const { expandPeerQueryVariants } = require('./waIdentity');

async function touchLeadLastContactedByPhone(userId, phone) {
  if (!userId || phone == null || phone === '') return;
  const variants = expandPeerQueryVariants(phone);
  if (!variants.length) return;
  await Lead.updateOne(
    { userId, phone: { $in: variants } },
    { $set: { lastContacted: new Date() } }
  ).catch(() => {});
}

async function touchLeadLastContactedByLeadId(userId, leadId) {
  if (!userId || !leadId) return;
  await Lead.updateOne(
    { _id: leadId, userId },
    { $set: { lastContacted: new Date() } }
  ).catch(() => {});
}

module.exports = {
  touchLeadLastContactedByPhone,
  touchLeadLastContactedByLeadId,
};
