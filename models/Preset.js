'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * Preset - a shared, server-persisted filter shortcut (year/month/date range/
 * assignee/priority/category). Stored in MongoDB so saved views are the same on
 * every device, replacing the old per-browser localStorage list.
 */
const presetSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    yr: { type: String, default: '' },
    moNum: { type: String, default: '' },
    sd: { type: String, default: '' }, // date from (yyyy-mm-dd)
    ed: { type: String, default: '' }, // date to
    ag: { type: String, default: '' }, // assignee
    pri: { type: String, default: '' }, // priority
    cat: { type: String, default: '' }, // category
    createdBy: { type: String, default: '' },
  },
  { timestamps: true },
);

presetSchema.set('toJSON', {
  transform(_doc, ret) { delete ret.__v; return ret; },
});

module.exports = mongoose.models.Preset || mongoose.model('Preset', presetSchema);
