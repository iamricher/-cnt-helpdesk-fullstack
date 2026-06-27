'use strict';

/**
 * SLA engine tests — the core business logic that must stay identical to the
 * client dashboard. Uses Node's built-in test runner (node:test), so there are
 * no extra dependencies. Run with: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../utils/slaEngine');

test('parseTime parses human-readable durations to seconds', () => {
  assert.equal(engine.parseTime('3 hours'), 10800);
  assert.equal(engine.parseTime('1 day 2 hours'), 93600);
  assert.equal(engine.parseTime('30 minutes'), 1800);
  assert.equal(engine.parseTime('half a minute'), 30);
  assert.equal(engine.parseTime('less than a minute'), 55);
  assert.equal(engine.parseTime('about 1 hour'), 3600);
  assert.equal(engine.parseTime('less than 5 seconds'), 5);
  assert.equal(engine.parseTime('42'), 42); // bare numeric = seconds
});

test('parseTime returns null for unparseable / empty input', () => {
  assert.equal(engine.parseTime('N/A'), null);
  assert.equal(engine.parseTime(''), null);
  assert.equal(engine.parseTime(null), null);
  assert.equal(engine.parseTime(undefined), null);
  assert.equal(engine.parseTime('-'), null);
});

test('isClosedStatus / statusBucket classify correctly', () => {
  assert.equal(engine.isClosedStatus('Closed'), true);
  assert.equal(engine.isClosedStatus('resolved'), true);
  assert.equal(engine.isClosedStatus('open'), false);
  assert.equal(engine.statusBucket('closed'), 'closed');
  assert.equal(engine.statusBucket('open'), 'open');
  assert.equal(engine.statusBucket('pending'), 'waiting');
});

test('getSlaTier falls back to the medium default for unknown priority', () => {
  assert.deepEqual(engine.getSlaTier('high'), engine.DEFAULT_TIERS.high);
  assert.deepEqual(engine.getSlaTier('nonsense'), engine.DEFAULT_TIERS.medium);
});

test('deriveTicketFields applies the documented close/first-response column swap', () => {
  const rec = engine.deriveTicketFields({
    id: 'T1',
    status: 'closed',
    priority: 'high',
    created: 'Jan 06, 2026 @ 12:55 am',
    // Source swap: close_time_secs holds First Response, first_response_secs holds Resolution.
    close_time_secs: '30 minutes', // -> First Response = 1800s
    first_response_secs: '2 hours', // -> Resolution    = 7200s
  });
  assert.equal(rec._frSecs, 1800);
  assert.equal(rec._ctSecs, 7200);
  // high tier: fr <= 1800, ct <= 28800 -> both pass
  assert.equal(rec._frPass, true);
  assert.equal(rec._ctPass, true);
});

test('deriveTicketFields marks open tickets as pending (never pass/fail)', () => {
  const rec = engine.deriveTicketFields({
    id: 'T2', status: 'open', priority: 'low', close_time_secs: '10 minutes', first_response_secs: '1 hour',
  });
  assert.equal(rec._frPass, 'pending');
  assert.equal(rec._ctPass, 'pending');
});

test('computeScorecard averages FR and CT compliance', () => {
  const data = [
    engine.deriveTicketFields({ id: 'A', status: 'closed', priority: 'high', close_time_secs: '10 minutes', first_response_secs: '1 hour' }),
    engine.deriveTicketFields({ id: 'B', status: 'closed', priority: 'high', close_time_secs: '10 minutes', first_response_secs: '1 hour' }),
  ];
  const card = engine.computeScorecard(data);
  assert.equal(card.frPct, 100);
  assert.equal(card.ctPct, 100);
  assert.equal(card.slaScore, 100);
  assert.equal(card.ticketTotal, 2);
  assert.equal(card.openCount, 0);
});

test('grade A is gated: a tier below 90% Resolution caps the grade at B', () => {
  // Two closed high tickets: one passes CT, one fails -> high tier = 50% < 90%.
  // Add many passing medium tickets to lift the overall score >= 95... but the
  // A-gate must still cap to B because the high tier misses.
  const data = [];
  // high: 1 pass, 1 fail (CT)
  data.push(engine.deriveTicketFields({ id: 'h1', status: 'closed', priority: 'high', close_time_secs: '5 minutes', first_response_secs: '1 hour' }));
  data.push(engine.deriveTicketFields({ id: 'h2', status: 'closed', priority: 'high', close_time_secs: '5 minutes', first_response_secs: '100 hours' }));
  // medium: many passes to push score up
  for (let i = 0; i < 50; i += 1) {
    data.push(engine.deriveTicketFields({ id: `m${i}`, status: 'closed', priority: 'medium', close_time_secs: '5 minutes', first_response_secs: '1 hour' }));
  }
  const card = engine.computeScorecard(data);
  assert.ok(card.highPct < 90, `expected high tier < 90, got ${card.highPct}`);
  assert.notEqual(card.g, 'A'); // capped despite high score
});

test('staleTickets flags open tickets idle beyond their priority threshold', () => {
  // Reference "now" is the LATEST ticket date in the set (engine.slaNow), so we
  // anchor the frame with an open ticket dated "now" (R0) and measure others
  // relative to it.
  const now = Date.now();
  const daysAgo = (d) => new Date(now - d * 864e5);
  const data = [
    { ticketId: 'R0', status: 'open', priority: 'low', _date: daysAgo(0) }, // anchors slaNow = now; idle 0 -> not stale
    { ticketId: 'S1', status: 'open', priority: 'high', _date: daysAgo(3) }, // 3d idle > 1d high threshold -> stale
    { ticketId: 'S2', status: 'open', priority: 'low', _date: daysAgo(2) }, // 2d idle < 7d low threshold -> not stale
    { ticketId: 'S3', status: 'closed', priority: 'high', _date: daysAgo(30) }, // closed -> never stale
  ];
  const stale = engine.staleTickets(data, { high: 1, medium: 3, low: 7 });
  const ids = stale.map((s) => s.r.ticketId);
  assert.deepEqual(ids, ['S1']);
});

test('ctComplianceStats counts live breaches in the denominator', () => {
  const now = Date.now();
  const data = [
    // closed & passed
    engine.deriveTicketFields({ id: 'c1', status: 'closed', priority: 'high', close_time_secs: '5 minutes', first_response_secs: '1 hour' }),
    // open, well past the high CT target (28800s = 8h) -> live breach
    { ticketId: 'o1', status: 'open', priority: 'high', _date: new Date(now - 48 * 3600 * 1000), _ctPass: 'pending' },
  ];
  const stats = engine.ctComplianceStats(data, engine.DEFAULT_TIERS, now);
  assert.equal(stats.liveBreaches, 1);
  assert.equal(stats.closedTotal, 1);
  assert.equal(stats.denom, 2); // 1 closed + 1 live breach
});
