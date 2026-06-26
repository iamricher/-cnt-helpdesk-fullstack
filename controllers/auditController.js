'use strict';

const AuditLog = require('../models/AuditLog');
const { ok, asyncHandler } = require('../utils/apiResponse');

const MAX_KEEP = 2000;

/** GET /api/audit - recent audit entries (admin+). */
const listAudit = asyncHandler(async (req, res) => {
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || '200', 10)));
  const entries = await AuditLog.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  trimAudit().catch(() => {});
  return ok(res, entries);
});

/** DELETE /api/audit - clear the audit log (superadmin). */
const clearAudit = asyncHandler(async (req, res) => {
  const r = await AuditLog.deleteMany({});
  return ok(res, { deleted: r.deletedCount }, 'Audit log cleared');
});

/** Internal: trim the audit log to the most recent MAX_KEEP rows. */
async function trimAudit() {
  const count = await AuditLog.estimatedDocumentCount();
  if (count <= MAX_KEEP) return;
  const cutoff = await AuditLog.find({}).sort({ createdAt: -1 }).skip(MAX_KEEP).limit(1).lean();
  if (cutoff[0]) await AuditLog.deleteMany({ createdAt: { $lt: cutoff[0].createdAt } });
}

module.exports = { listAudit, clearAudit, trimAudit };
