'use strict';

const Preset = require('../models/Preset');
const { ok, created, fail, asyncHandler } = require('../utils/apiResponse');

const FIELDS = ['yr', 'moNum', 'sd', 'ed', 'ag', 'pri', 'cat'];

/** GET /api/presets - shared filter presets (any authenticated user). */
const listPresets = asyncHandler(async (req, res) => {
  const presets = await Preset.find({}).sort({ createdAt: 1 }).lean();
  return ok(res, presets.map((p) => ({ ...p, id: String(p._id) })));
});

/** POST /api/presets - create a shared filter preset. */
const createPreset = asyncHandler(async (req, res) => {
  const name = (req.body && req.body.name ? String(req.body.name) : '').trim();
  if (!name) return fail(res, 'Preset name is required', 422);
  const doc = { name, createdBy: req.user.username };
  FIELDS.forEach((f) => { doc[f] = req.body && req.body[f] != null ? String(req.body[f]) : ''; });
  const p = await Preset.create(doc);
  const obj = p.toJSON();
  return created(res, { ...obj, id: String(p._id) }, 'Preset saved');
});

/** DELETE /api/presets/:id - remove a shared preset. */
const deletePreset = asyncHandler(async (req, res) => {
  const r = await Preset.deleteOne({ _id: req.params.id });
  if (!r.deletedCount) return fail(res, 'Preset not found', 404);
  return ok(res, { deleted: r.deletedCount }, 'Preset deleted');
});

module.exports = { listPresets, createPreset, deletePreset };
