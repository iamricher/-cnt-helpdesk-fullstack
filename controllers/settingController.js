'use strict';

const Setting = require('../models/Setting');
const AuditLog = require('../models/AuditLog');
const { ok, asyncHandler } = require('../utils/apiResponse');
const { refreshTodaySnapshot } = require('./ticketController');

/** GET /api/settings - shared SLA tiers + stale thresholds. */
const getSettings = asyncHandler(async (req, res) => {
  const s = await Setting.getGlobal();
  return ok(res, s.toJSON());
});

/** PUT /api/settings - update SLA tiers / stale thresholds (admin+). */
const updateSettings = asyncHandler(async (req, res) => {
  const s = await Setting.getGlobal();
  const { slaTiers, staleThresholds } = req.body;

  if (slaTiers) {
    ['high', 'medium', 'low'].forEach((tier) => {
      if (slaTiers[tier]) {
        if (typeof slaTiers[tier].fr === 'number' && slaTiers[tier].fr > 0) s.slaTiers[tier].fr = Math.round(slaTiers[tier].fr);
        if (typeof slaTiers[tier].ct === 'number' && slaTiers[tier].ct > 0) s.slaTiers[tier].ct = Math.round(slaTiers[tier].ct);
      }
    });
  }
  if (staleThresholds) {
    ['high', 'medium', 'low'].forEach((tier) => {
      if (typeof staleThresholds[tier] === 'number' && staleThresholds[tier] > 0) s.staleThresholds[tier] = staleThresholds[tier];
    });
  }
  await s.save();
  // Recompute today's snapshot so the change reflects immediately in trends.
  await refreshTodaySnapshot();
  await AuditLog.create({ type: 'sla', message: 'SLA / stale settings updated', actor: req.user.username, ip: req.ip || '' });
  return ok(res, s.toJSON(), 'Settings updated');
});

module.exports = { getSettings, updateSettings };
