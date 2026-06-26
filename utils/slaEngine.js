'use strict';

/**
 * SLA ENGINE - server-side port of the original client-side business logic.
 *
 * Every function here mirrors the exact behaviour of the single-file dashboard
 * so that grades, compliance percentages and breach counts computed on the
 * server are identical to what the original app produced. Do not "improve" the
 * math here without changing the client in lockstep - drift between the two
 * would silently corrupt reported metrics.
 */

const MONTHS_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CLOSED_STATUSES = new Set([
  'closed', 'resolved', 'done', 'complete', 'completed', 'fixed', 'finished', 'solved',
]);

const DEFAULT_TIERS = {
  high: { fr: 1800, ct: 28800 },
  medium: { fr: 3600, ct: 86400 },
  low: { fr: 14400, ct: 259200 },
};
const DEFAULT_TIER = 'medium';

function getSlaTier(priority, tiers = DEFAULT_TIERS) {
  const p = (priority || '').toLowerCase();
  return tiers[p] || tiers[DEFAULT_TIER];
}

function isClosedStatus(status) {
  return CLOSED_STATUSES.has((status || '').trim().toLowerCase());
}

function statusBucket(status) {
  const st = (status || '').trim().toLowerCase();
  if (isClosedStatus(st)) return 'closed';
  if (st === 'open') return 'open';
  return 'waiting';
}

/**
 * Parse a human-readable duration ("3 hours", "less than a minute", "1 day 2 hours")
 * into seconds. Returns null when unparseable. Ported verbatim from the client.
 */
function parseTime(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === 'n/a' || s === '-' || s === 'null') return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const uv = (u) => (
    u.startsWith('day') ? 86400
      : u.startsWith('hour') || u === 'hr' ? 3600
        : u.startsWith('min') ? 60
          : u.startsWith('month') ? 2592000
            : 1
  );
  let m;
  let total = 0;
  let hit = false;
  if (s.includes('half a minute')) return 30;
  if (s.includes('less than a minute')) return 55;
  m = s.match(/less than (\d+)\s*(month|day|hour|hr|min|sec)/);
  if (m) return +m[1] * uv(m[2]);
  m = s.match(/about (\d+)\s*(month|day|hour|hr|min|sec)/);
  if (m) return +m[1] * uv(m[2]);
  const re = /(\d+(?:\.\d+)?)\s*(month|day|hour|hr|min|sec)/g;
  while ((m = re.exec(s)) !== null) {
    total += +m[1] * uv(m[2]);
    hit = true;
  }
  return hit ? total : null;
}

/**
 * Shift a Spiceworks GMT timestamp string ("Jan 06, 2026 @ 12:55 am") to UTC+8.
 * Confirmed with the source: exports are in GMT and must be shifted +8h.
 * Returns the original string if it doesn't match the expected format.
 */
function shiftGmtToUtc8(raw) {
  if (!raw) return raw;
  const m = String(raw).match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s+@\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return raw;
  const [, monStr, dayStr, yearStr, hourStr, minStr, ampm] = m;
  const monIdx = MONTHS_ABBR.findIndex((x) => x.toLowerCase() === monStr.toLowerCase());
  if (monIdx === -1) return raw;
  let hour = parseInt(hourStr, 10);
  const isPM = ampm.toLowerCase() === 'pm';
  if (hour === 12) hour = isPM ? 12 : 0;
  else if (isPM) hour += 12;
  const dt = new Date(Date.UTC(parseInt(yearStr, 10), monIdx, parseInt(dayStr, 10), hour, parseInt(minStr, 10)));
  dt.setUTCHours(dt.getUTCHours() + 8);
  const outMon = MONTHS_ABBR[dt.getUTCMonth()];
  const outDay = String(dt.getUTCDate()).padStart(2, '0');
  const outYear = dt.getUTCFullYear();
  const outHour24 = dt.getUTCHours();
  const outAmpm = outHour24 >= 12 ? 'pm' : 'am';
  let outHour12 = outHour24 % 12;
  if (outHour12 === 0) outHour12 = 12;
  const outHour12Str = String(outHour12).padStart(2, '0');
  const outMin = String(dt.getUTCMinutes()).padStart(2, '0');
  return `${outMon} ${outDay}, ${outYear} @ ${outHour12Str}:${outMin} ${outAmpm}`;
}

/**
 * Derive all computed SLA fields for one raw ticket record.
 * IMPORTANT - column swap: in the source export `close_time_secs` actually holds
 * the First Response time and `first_response_secs` holds the Resolution/Close
 * time. The mapping below preserves that confirmed swap.
 */
function deriveTicketFields(rec, tiers = DEFAULT_TIERS) {
  const r = { ...rec };

  ['created', 'date', 'created_at'].forEach((c) => {
    if (r[c] && r[c] !== 'N/A') r[c] = shiftGmtToUtc8(r[c]);
  });
  const rawDate = r.created || r.date || r.created_at || '';
  const d = new Date(rawDate);
  r._date = Number.isNaN(d.getTime()) ? null : d;

  // Column swap (see note above)
  r._frSecs = parseTime(r.close_time_secs != null ? r.close_time_secs : null);
  r._ctSecs = parseTime(r.first_response_secs != null ? r.first_response_secs : null);

  const closed = isClosedStatus(r.status);
  const tier = getSlaTier(r.priority, tiers);
  r._frPass = !closed ? 'pending' : (r._frSecs !== null ? r._frSecs <= tier.fr : null);
  r._ctPass = !closed ? 'pending' : (r._ctSecs !== null ? r._ctSecs <= tier.ct : null);

  return r;
}

/** Reference "now" for breach math: the latest ticket date, or real now if empty. */
function slaNow(data) {
  const times = data.map((r) => (r._date ? new Date(r._date).getTime() : null)).filter((t) => t != null);
  return times.length ? Math.max(...times) : Date.now();
}

/**
 * Resolution (CT) compliance, breach-inclusive. The denominator counts closed
 * tickets (known pass/fail) plus open tickets already past their CT target
 * (live breaches), so active breaches can't hide behind a high percentage.
 */
function ctComplianceStats(data, tiers = DEFAULT_TIERS, nowOverride) {
  const now = nowOverride != null ? nowOverride : slaNow(data);
  const closedR = data.filter((r) => typeof r._ctPass === 'boolean');
  const closedPass = closedR.filter((r) => r._ctPass === true).length;
  const liveBreaches = data.filter((r) => statusBucket(r.status) !== 'closed'
    && r._date
    && (now - new Date(r._date).getTime()) / 1000 > getSlaTier(r.priority, tiers).ct).length;
  const denom = closedR.length + liveBreaches;
  const pct = denom ? (closedPass / denom) * 100 : NaN;
  return { pct, closedTotal: closedR.length, closedPass, liveBreaches, denom };
}

/** First Response pass rate over closed tickets with a known FR result. */
function frComplianceStats(data) {
  const frR = data.filter((r) => typeof r._frPass === 'boolean');
  const frPass = frR.filter((r) => r._frPass === true).length;
  const pct = frR.length ? (frPass / frR.length) * 100 : NaN;
  return { pct, frTotal: frR.length, frPass };
}

/**
 * Overall grade with the A-gate: a >=95 score is only an A when there are zero
 * live breaches AND every priority tier is at >=90% Resolution compliance.
 * Otherwise it caps at B. Identical to the client engine.
 */
function computeOverallGrade(sc, data, tiers = DEFAULT_TIERS) {
  const now = slaNow(data);
  const liveBreaches = ctComplianceStats(data, tiers, now).liveBreaches;
  const tierPct = (p) => ctComplianceStats(
    data.filter((r) => (r.priority || '').toLowerCase() === p), tiers, now,
  ).pct;
  const highPct = tierPct('high');
  const medPct = tierPct('medium');
  const lowPct = tierPct('low');
  const hasBreaches = liveBreaches > 0;
  const anyMiss = [highPct, medPct, lowPct].some((p) => !Number.isNaN(p) && p < 90);

  let g;
  let gLabel;
  if (Number.isNaN(sc)) { g = '?'; gLabel = 'NO DATA'; } else if (sc >= 95 && !hasBreaches && !anyMiss) { g = 'A'; gLabel = 'EXCEEDS EXPECTATIONS'; } else if (sc >= 90) { g = 'B'; gLabel = 'MEETS EXPECTATIONS'; } else if (sc >= 80) { g = 'C'; gLabel = 'NEEDS IMPROVEMENT'; } else if (sc >= 70) { g = 'D'; gLabel = 'PERFORMANCE PLAN'; } else { g = 'F'; gLabel = 'UNACCEPTABLE'; }

  return {
    g,
    gLabel,
    hasBreaches,
    anyMiss,
    liveBreaches,
    highPct,
    medPct,
    lowPct,
    capped: !Number.isNaN(sc) && sc >= 95 && g !== 'A',
  };
}

/** Compute the headline SLA score (avg of FR and CT compliance) plus grade. */
function computeScorecard(data, tiers = DEFAULT_TIERS) {
  const fr = frComplianceStats(data);
  const ct = ctComplianceStats(data, tiers);
  let sc;
  if (!Number.isNaN(fr.pct) && !Number.isNaN(ct.pct)) sc = (fr.pct + ct.pct) / 2;
  else if (!Number.isNaN(fr.pct)) sc = fr.pct;
  else sc = ct.pct;
  const grade = computeOverallGrade(sc, data, tiers);
  return {
    slaScore: Number.isNaN(sc) ? null : +sc.toFixed(2),
    frPct: Number.isNaN(fr.pct) ? null : +fr.pct.toFixed(2),
    ctPct: Number.isNaN(ct.pct) ? null : +ct.pct.toFixed(2),
    openCount: data.filter((r) => statusBucket(r.status) !== 'closed').length,
    ticketTotal: data.length,
    ...grade,
  };
}

/** Stale: open ticket whose last activity exceeds its priority threshold (days). */
function staleTickets(data, thresholds = { high: 1, medium: 3, low: 7 }) {
  const now = slaNow(data);
  const thrFor = (p) => {
    const k = (p || '').toLowerCase();
    return thresholds[k] != null ? thresholds[k] : (thresholds.medium || 3);
  };
  return data
    .filter((r) => statusBucket(r.status) !== 'closed' && r._date)
    .map((r) => ({ r, days: (now - new Date(r._date).getTime()) / 864e5 }))
    .filter(({ r, days }) => days > thrFor(r.priority))
    .sort((a, b) => b.days - a.days);
}

module.exports = {
  MONTHS_ABBR,
  CLOSED_STATUSES,
  DEFAULT_TIERS,
  getSlaTier,
  isClosedStatus,
  statusBucket,
  parseTime,
  shiftGmtToUtc8,
  deriveTicketFields,
  slaNow,
  ctComplianceStats,
  frComplianceStats,
  computeOverallGrade,
  computeScorecard,
  staleTickets,
};
