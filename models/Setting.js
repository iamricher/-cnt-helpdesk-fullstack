'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * Setting - a single shared, server-side settings document (singleton pattern,
 * key always "global"). Holds SLA tiers and stale thresholds so every device
 * sees the same configuration.
 */
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    slaTiers: {
      high: { fr: { type: Number, default: 1800 }, ct: { type: Number, default: 28800 } },
      medium: { fr: { type: Number, default: 3600 }, ct: { type: Number, default: 86400 } },
      low: { fr: { type: Number, default: 14400 }, ct: { type: Number, default: 259200 } },
    },
    staleThresholds: {
      high: { type: Number, default: 1 },
      medium: { type: Number, default: 3 },
      low: { type: Number, default: 7 },
    },
  },
  { timestamps: true },
);

settingSchema.set('toJSON', {
  transform(_doc, ret) { delete ret.__v; return ret; },
});

settingSchema.statics.getGlobal = async function getGlobal() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

module.exports = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
