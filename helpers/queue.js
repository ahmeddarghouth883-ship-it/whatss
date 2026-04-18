const Queue = require('bull');

function useCampaignQueue() {
  if (process.env.USE_CAMPAIGN_QUEUE === '1') return true;
  if (process.env.USE_CAMPAIGN_QUEUE === '0') return false;
  return process.env.NODE_ENV === 'production';
}

function resolveRedisUrl() {
  let redisUrl = process.env.REDIS_URL;
  if (!redisUrl && process.env.REDIS_HOST && process.env.REDIS_PORT) {
    redisUrl = `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;
  } else if (!redisUrl) {
    redisUrl = 'redis://127.0.0.1:6379';
  }
  return redisUrl;
}

let campaignQueue = null;

function getCampaignQueue() {
  if (!useCampaignQueue()) return null;
  if (campaignQueue) return campaignQueue;

  campaignQueue = new Queue('campaign-messages', resolveRedisUrl());
  campaignQueue.on('error', (error) => {
    console.error('[Bull] Queue Error:', error);
  });
  return campaignQueue;
}

module.exports = { getCampaignQueue, useCampaignQueue };
