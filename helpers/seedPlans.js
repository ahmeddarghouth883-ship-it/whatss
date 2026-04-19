/**
 * helpers/seedPlans.js — idempotent seed of the 4 plan tiers.
 * Called from server.js on boot, right after seedAdminUser().
 */

const Plan = require('../models/Plan');

const PLANS = [
  {
    code:      'free_trial',
    label:     'Free Trial',
    blurb:     'Try the platform: 20 credits, no card required, never renews.',
    priceUsd:  0,
    priceTnd:  0,
    credits:   20,
    isCustom:  false,
    oneTime:   true,
    sortOrder: 0,
    features: [
      '20 credits total (one-time)',
      '20 lead extractions OR 40 messages',
      'Full access to all features',
      'No payment method required',
    ],
  },
  {
    code:      'basic',
    label:     'Basic',
    blurb:     'For solo operators and small teams getting started with outreach.',
    priceUsd:  29,
    priceTnd:  90,
    credits:   1500,
    isCustom:  false,
    oneTime:   false,
    sortOrder: 1,
    features: [
      '1,500 credits per pack',
      '1,500 extractions OR 3,000 messages',
      '1 connected WhatsApp number',
      'Standard rate limits',
      'Email support',
    ],
  },
  {
    code:      'pro',
    label:     'Pro',
    blurb:     'Agencies and sales teams running daily campaigns at scale.',
    priceUsd:  79,
    priceTnd:  245,
    credits:   6000,
    isCustom:  false,
    oneTime:   false,
    sortOrder: 2,
    features: [
      '6,000 credits per pack',
      '6,000 extractions OR 12,000 messages',
      'Up to 3 WhatsApp numbers',
      'Higher rate limits & priority queue',
      'Priority email support',
    ],
  },
  {
    code:      'enterprise',
    label:     'Enterprise',
    blurb:     'High-volume outbound, custom limits, dedicated support.',
    priceUsd:  0,
    priceTnd:  0,
    credits:   0,
    isCustom:  true,
    oneTime:   false,
    sortOrder: 3,
    features: [
      'Custom credit pack & pricing',
      'Unlimited connected numbers (subject to infra)',
      'Custom rate limits',
      'Dedicated account manager',
      'SLA & onboarding support',
    ],
  },
];

async function seedPlans() {
  try {
    let created = 0;
    let updated = 0;
    for (const p of PLANS) {
      const existing = await Plan.findOne({ code: p.code });
      if (!existing) {
        await Plan.create({ ...p, active: true });
        created++;
      } else {
        // Refresh non-destructive fields so admins editing prices keep their changes,
        // but we always re-sync features/blurb/sortOrder/active.
        existing.label     = p.label;
        existing.blurb     = p.blurb;
        existing.features  = p.features;
        existing.sortOrder = p.sortOrder;
        existing.isCustom  = p.isCustom;
        existing.oneTime   = p.oneTime;
        existing.active    = true;
        if (existing.priceUsd == null) existing.priceUsd = p.priceUsd;
        if (existing.priceTnd == null) existing.priceTnd = p.priceTnd;
        if (existing.credits  == null) existing.credits  = p.credits;
        await existing.save();
        updated++;
      }
    }
    if (created || updated) {
      console.log(`[seedPlans] ${created} created, ${updated} updated`);
    }
  } catch (err) {
    console.error('[seedPlans] failed:', err.message);
  }
}

module.exports = { seedPlans, PLANS };
