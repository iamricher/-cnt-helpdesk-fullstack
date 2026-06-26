'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * DailySnapshot - one persisted performance snapshot per calendar day, shared
 * across all users. Feeds the trend lines. `date` (YYYY-MM-DD) is unique so the
 * latest load of a given day overwrites that day's row (upsert on date).
 */
const snapshotSchema = new Schema(
  {
    date: { type: String, required: true, unique: true, index: true }, // YYYY-MM-DD
    slaScore: { type: Number, default: null },
    grade: { type: String, default: '?' },
    openCount: { type: Number, default: 0 },
    breachCount: { type: Number, default: 0 },
    staleCount: { type: Number, default: 0 },
    highPct: { type: Number, default: null },
    medPct: { type: Number, default: null },
    lowPct: { type: Number, default: null },
    ticketTotal: { type: Number, default: 0 },
  },
  { timestamps: true },
);

snapshotSchema.set('toJSON', {
  transform(_doc, ret) { delete ret.__v; return ret; },
});

module.exports = mongoose.models.DailySnapshot || mongoose.model('DailySnapshot', snapshotSchema);
