'use strict';

const Papa = require('papaparse');
const Ticket = require('../models/Ticket');
const DailySnapshot = require('../models/Snapshot');
const AuditLog = require('../models/AuditLog');
const Setting = require('../models/Setting');
const engine = require('../utils/slaEngine');
const {
  ok, created, fail, asyncHandler, ApiError,
} = require('../utils/apiResponse');

/** Resolve current SLA tiers + stale thresholds from the shared Setting doc. */
async function getConfig() {
  const s = await Setting.getGlobal();
  const tiers = {
    high: { fr: s.slaTiers.high.fr, ct: s.slaTiers.high.ct },
    medium: { fr: s.slaTiers.medium.fr, ct: s.slaTiers.medium.ct },
    low: { fr: s.slaTiers.low.fr, ct: s.slaTiers.low.ct },
  };
  const thresholds = {
    high: s.staleThresholds.high, medium: s.staleThresholds.medium, low: s.staleThresholds.low,
  };
  return { tiers, thresholds };
}

/** Load all tickets as engine records (plain objects). */
async function loadEngineRecords() {
  const docs = await Ticket.find({}).lean();
  return docs.map((d) => ({
    id: d.ticketId,
    ticketId: d.ticketId,
    summary: d.summary,
    assignee: d.assignee,
    creator: d.creator,
    organization: d.organization,
    priority: d.priority,
    category: d.category,
    status: d.status,
    created: d.created,
    close_time_secs: d.closeTimeSecsRaw,
    first_response_secs: d.firstResponseSecsRaw,
    _date: d.date,
    _frSecs: d.frSecs,
    _ctSecs: d.ctSecs,
    _frPass: d.frPass,
    _ctPass: d.ctPass,
  }));
}

/**
 * GET /api/tickets
 * Optional query: priority, status, assignee, category, from, to, limit, page.
 * Returns shared tickets for every authenticated user (multi-device sync).
 */
const listTickets = asyncHandler(async (req, res) => {
  const {
    priority, status, assignee, category, from, to,
  } = req.query;
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit || '1000', 10)));

  const filter = {};
  if (priority) filter.priority = priority;
  if (status) filter.status = status;
  if (assignee) filter.assignee = assignee;
  if (category) filter.category = category;
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = new Date(from);
    if (to) { const end = new Date(to); end.setHours(23, 59, 59, 999); filter.date.$lte = end; }
  }

  const [items, total] = await Promise.all([
    Ticket.find(filter).sort({ date: -1 }).skip((page - 1) * limit).limit(limit)
      .lean(),
    Ticket.countDocuments(filter),
  ]);

  return ok(res, items, 'Tickets fetched', 200, {
    page, limit, total, pages: Math.ceil(total / limit),
  });
});

/**
 * POST /api/tickets/upload  (multipart field "file" OR JSON { csv: "..." })
 * Parses a Spiceworks CSV server-side, derives SLA fields, and upserts each
 * row by ticketId so re-uploads sync rather than duplicate. Then refreshes
 * today's snapshot. Restricted to itstaff+ in the route layer.
 */
const uploadCsv = asyncHandler(async (req, res) => {
  let csvText = null;
  if (req.file && req.file.buffer) csvText = req.file.buffer.toString('utf8');
  else if (req.body && typeof req.body.csv === 'string') csvText = req.body.csv;
  if (!csvText || !csvText.trim()) throw new ApiError('No CSV content provided', 400);

  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  if (parsed.errors && parsed.errors.length && !parsed.data.length) {
    throw new ApiError('Could not parse CSV file', 422, parsed.errors.slice(0, 3));
  }
  const rows = parsed.data.filter((r) => r && Object.keys(r).length);
  if (!rows.length) throw new ApiError('CSV contained no data rows', 422);

  const { tiers } = await getConfig();

  // Within-file dedup: last-wins on ticket id
  const byKey = new Map();
  rows.forEach((row, idx) => {
    const idVal = row.id != null && String(row.id).trim() !== '' ? String(row.id).trim() : `ROW-${idx}`;
    byKey.set(idVal.toLowerCase(), { row, idVal });
  });

  const ops = [];
  let processed = 0;
  for (const { row, idVal } of byKey.values()) {
    // Normalise blanks to N/A, mirror client behaviour
    const norm = {};
    Object.entries(row).forEach(([k, v]) => {
      norm[k] = (v === undefined || v === null || String(v).trim() === '') ? 'N/A' : String(v).trim();
    });
    const ticketId = (norm.id && norm.id !== 'N/A') ? norm.id : idVal;

    const derived = engine.deriveTicketFields({
      id: ticketId,
      status: norm.status,
      priority: norm.priority,
      created: norm.created,
      date: norm.date,
      created_at: norm.created_at,
      close_time_secs: norm.close_time_secs,
      first_response_secs: norm.first_response_secs,
    }, tiers);

    // Collect any unmodelled columns into `extra`
    const known = new Set(['id', 'summary', 'assignee', 'creator', 'organization', 'priority',
      'category', 'status', 'created', 'date', 'created_at', 'close_time_secs', 'first_response_secs']);
    const extra = {};
    Object.entries(norm).forEach(([k, v]) => { if (!known.has(k)) extra[k] = v; });

    ops.push({
      updateOne: {
        filter: { ticketId },
        update: {
          $set: {
            ticketId,
            summary: norm.summary || 'N/A',
            assignee: norm.assignee || 'N/A',
            creator: norm.creator || 'N/A',
            organization: norm.organization || 'N/A',
            priority: norm.priority || 'N/A',
            category: norm.category || 'N/A',
            status: norm.status || 'N/A',
            created: derived.created || norm.created || 'N/A',
            closeTimeSecsRaw: norm.close_time_secs || 'N/A',
            firstResponseSecsRaw: norm.first_response_secs || 'N/A',
            date: derived._date,
            frSecs: derived._frSecs,
            ctSecs: derived._ctSecs,
            frPass: derived._frPass,
            ctPass: derived._ctPass,
            extra,
          },
        },
        upsert: true,
      },
    });
    processed += 1;
  }

  let upserted = 0;
  let modified = 0;
  if (ops.length) {
    const result = await Ticket.bulkWrite(ops, { ordered: false });
    upserted = result.upsertedCount || 0;
    modified = result.modifiedCount || 0;
  }

  await refreshTodaySnapshot();

  await AuditLog.create({
    type: 'upload',
    message: `CSV upload: ${upserted} new, ${modified} updated (${processed} rows processed)`,
    actor: req.user ? req.user.username : 'system',
    ip: req.ip || '',
  });

  return created(res, { processed, upserted, modified }, 'Upload processed');
});

/** Compute and persist today's snapshot from the full ticket set. */
async function refreshTodaySnapshot() {
  const { tiers, thresholds } = await getConfig();
  const records = await loadEngineRecords();
  if (!records.length) return null;

  const card = engine.computeScorecard(records, tiers);
  const ct = engine.ctComplianceStats(records, tiers);
  const stale = engine.staleTickets(records, thresholds).length;
  const date = new Date().toISOString().slice(0, 10);

  const doc = await DailySnapshot.findOneAndUpdate(
    { date },
    {
      $set: {
        date,
        slaScore: card.slaScore,
        grade: card.g,
        openCount: card.openCount,
        breachCount: ct.liveBreaches,
        staleCount: stale,
        highPct: card.highPct != null && !Number.isNaN(card.highPct) ? +card.highPct.toFixed(2) : null,
        medPct: card.medPct != null && !Number.isNaN(card.medPct) ? +card.medPct.toFixed(2) : null,
        lowPct: card.lowPct != null && !Number.isNaN(card.lowPct) ? +card.lowPct.toFixed(2) : null,
        ticketTotal: card.ticketTotal,
      },
    },
    { upsert: true, new: true },
  );
  return doc;
}

/** GET /api/tickets/stats - the live scorecard + stale list computed server-side. */
const getStats = asyncHandler(async (req, res) => {
  const { tiers, thresholds } = await getConfig();
  const records = await loadEngineRecords();
  const card = engine.computeScorecard(records, tiers);
  const stale = engine.staleTickets(records, thresholds)
    .slice(0, 100)
    .map(({ r, days }) => ({
      ticketId: r.ticketId, summary: r.summary, assignee: r.assignee, priority: r.priority, status: r.status, idleDays: +days.toFixed(1),
    }));
  return ok(res, { scorecard: card, stale, staleTotal: engine.staleTickets(records, thresholds).length });
});

/** GET /api/snapshots - trend history. */
const listSnapshots = asyncHandler(async (req, res) => {
  const limit = Math.min(365, Math.max(2, parseInt(req.query.limit || '180', 10)));
  const snaps = await DailySnapshot.find({}).sort({ date: 1 }).limit(limit).lean();
  return ok(res, snaps);
});

/** DELETE /api/tickets - wipe all tickets (admin+). */
const wipeTickets = asyncHandler(async (req, res) => {
  const result = await Ticket.deleteMany({});
  await AuditLog.create({
    type: 'upload', message: `All tickets wiped (${result.deletedCount})`, actor: req.user.username, ip: req.ip || '',
  });
  return ok(res, { deleted: result.deletedCount }, 'All tickets removed');
});

module.exports = {
  listTickets, uploadCsv, getStats, listSnapshots, wipeTickets, refreshTodaySnapshot,
};
