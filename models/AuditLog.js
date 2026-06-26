'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * AuditLog - append-only record of meaningful actions (login, upload, settings
 * change, user CRUD). Capped via a TTL-free rolling delete in the controller to
 * keep the collection bounded.
 */
const auditSchema = new Schema(
  {
    type: { type: String, required: true, index: true }, // login | upload | sla | user | auth
    message: { type: String, required: true },
    actor: { type: String, default: 'system' }, // username
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    ip: { type: String, default: '' },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

auditSchema.index({ createdAt: -1 });

auditSchema.set('toJSON', {
  transform(_doc, ret) { delete ret.__v; return ret; },
});

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditSchema);
