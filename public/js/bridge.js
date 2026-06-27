/**
 * Backend bridge for the CNT Helpdesk dashboard.
 *
 * The original dashboard authenticated and stored data entirely client-side.
 * This bridge re-points those flows at the Express + MongoDB backend WITHOUT
 * rewriting the analytics layer:
 *   - Auth (login / register / session) -> JWT via /api/auth
 *   - Ticket data -> fetched from /api/tickets into the existing masterData
 *   - CSV upload -> POSTed to /api/tickets/upload (server parses + persists)
 *   - Settings & users -> backend collections
 *
 * It runs AFTER the dashboard script, overriding specific globals by name.
 * If a function isn't present (older build), the override is skipped safely.
 */
(function bridge(global) {
  'use strict';

  const D = global; // dashboard globals live on window

  // Called by api-client when a 401 invalidates the session.
  global.onAuthExpired = function onAuthExpired() {
    showAuthScreen();
  };

  function $(id) { return document.getElementById(id); }
  function toastSafe(msg, type) { if (typeof D.toast === 'function') D.toast(msg, type); else console.log(`[${type}] ${msg}`); }

  function showAuthScreen() {
    const auth = $('authScreen'); const app = $('app');
    if (auth) auth.style.display = 'flex';
    if (app) app.style.display = 'none';
  }
  function showApp() {
    const auth = $('authScreen'); const app = $('app');
    if (auth) auth.style.display = 'none';
    if (app) app.style.display = 'block';
  }

  /** Map a backend ticket document into the engine record the dashboard expects. */
  function toClientRecord(t) {
    const r = {
      id: t.ticketId,
      summary: t.summary,
      assignee: t.assignee,
      creator: t.creator,
      organization: t.organization,
      priority: t.priority,
      category: t.category,
      status: t.status,
      created: t.created,
      close_time_secs: t.closeTimeSecsRaw,
      first_response_secs: t.firstResponseSecsRaw,
      _date: t.date ? new Date(t.date) : null,
      _frSecs: t.frSecs,
      _ctSecs: t.ctSecs,
      _frPass: t.frPass,
      _ctPass: t.ctPass,
    };
    if (t.extra) Object.entries(t.extra).forEach(([k, v]) => { if (r[k] === undefined) r[k] = v; });
    return r;
  }

  /** Pull all tickets from the backend into masterData and refresh the UI. */
  async function loadTicketsFromServer() {
    try {
      const all = [];
      let page = 1;
      const limit = 2000;
      // Page through until we've fetched everything.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await API.listTickets({ page, limit });
        all.push(...res.data);
        const { pages } = res.meta || { pages: 1 };
        if (page >= (pages || 1)) break;
        page += 1;
      }
      D.masterData = all.map(toClientRecord);
      D.filteredData = [...D.masterData];
      if (typeof D.allCols !== 'undefined') {
        const cs = new Set();
        D.masterData.forEach((r) => Object.keys(r).filter((k) => !k.startsWith('_')).forEach((k) => cs.add(k)));
        D.allCols = [...cs];
      }
      if (typeof D.buildFilterDropdowns === 'function') D.buildFilterDropdowns();
      if (typeof D.applyFilter === 'function') D.applyFilter();
      if (typeof D.renderUploadSummary === 'function') D.renderUploadSummary();
      const chip = $('dataChip'); const chipN = $('dataChipN'); const noData = $('noDataMsg');
      if (D.masterData.length) {
        if (chip) chip.style.display = 'inline-flex';
        if (chipN) chipN.textContent = D.masterData.length.toLocaleString();
        if (noData) noData.style.display = 'none';
      } else if (noData) noData.style.display = 'block';
    } catch (e) {
      toastSafe(`Could not load tickets: ${e.message}`, 'error');
    }
  }
  global.loadTicketsFromServer = loadTicketsFromServer;

  /** Apply role -> sets currentUser and runs the dashboard's role UI if present. */
  function applySession(user) {
    D.currentUser = { id: user.id, username: user.username, name: user.name, role: user.role };
    API.setUser(user);
    if (typeof D.applyRoleUI === 'function') {
      try { D.applyRoleUI(); } catch (e) { /* non-fatal */ }
    }
  }

  // ── Override: login ──
  global.doLogin = async function doLogin() {
    const uEl = $('authUser') || $('loginUser') || $('username') || $('li-user');
    const pEl = $('authPass') || $('loginPass') || $('password') || $('li-pass');
    const errEl = $('authErr') || $('loginErr');
    const username = uEl ? uEl.value.trim() : '';
    const password = pEl ? pEl.value : '';
    if (!username || !password) { if (errEl) { errEl.textContent = 'Enter username and password.'; errEl.style.display = 'flex'; } return; }
    try {
      const res = await API.login({ username, password });
      API.setToken(res.data.token);
      applySession(res.data.user);
      showApp();
      await syncSettingsFromServer();
      await loadTicketsFromServer();
      if (typeof D.startSession === 'function') D.startSession();
      toastSafe(`Welcome back, ${res.data.user.name || res.data.user.username}.`, 'success');
    } catch (e) {
      if (errEl) { errEl.textContent = e.message; errEl.style.display = 'flex'; }
      else toastSafe(e.message, 'error');
    }
  };

  // ── Override: register (if the UI exposes it) ──
  global.doRegister = async function doRegister() {
    const u = ($('regUser') || {}).value;
    const p = ($('regPass') || {}).value;
    const n = ($('regName') || {}).value;
    try {
      const res = await API.register({ username: u, password: p, name: n });
      API.setToken(res.data.token);
      applySession(res.data.user);
      showApp();
      await syncSettingsFromServer();
      await loadTicketsFromServer();
      toastSafe('Account created.', 'success');
    } catch (e) {
      toastSafe(e.message, 'error');
    }
  };

  // ── Override: logout ──
  const origLogout = D.logout;
  global.logout = function logout() {
    API.clearToken();
    D.currentUser = null;
    D.masterData = [];
    D.filteredData = [];
    if (typeof origLogout === 'function') {
      try { origLogout(); return; } catch (e) { /* fall through */ }
    }
    showAuthScreen();
  };

  // ── Override: CSV upload -> server ──
  global.handleFiles = async function handleFiles(files) {
    if (!files || !files.length) return;
    if (D.currentUser && ['viewer'].includes(D.currentUser.role)) {
      toastSafe('You do not have permission to upload.', 'error');
      return;
    }
    const spin = $('dzSpin'); const inner = $('dzInner');
    if (inner) inner.style.display = 'none';
    if (spin) spin.style.display = 'block';
    try {
      let totalNew = 0; let totalUpd = 0;
      for (const file of files) {
        // eslint-disable-next-line no-await-in-loop
        const res = await API.uploadCsvFile(file);
        totalNew += res.data.upserted || 0;
        totalUpd += res.data.modified || 0;
      }
      await loadTicketsFromServer();
      if (typeof D.updateHealthBar === 'function') D.updateHealthBar();
      toastSafe(`${totalNew} added, ${totalUpd} updated.`, 'success');
    } catch (e) {
      toastSafe(`Upload failed: ${e.message}`, 'error');
    } finally {
      if (spin) spin.style.display = 'none';
      if (inner) inner.style.display = 'block';
    }
  };

  /** Pull shared SLA tiers + stale thresholds into the dashboard globals. */
  async function syncSettingsFromServer() {
    try {
      const res = await API.getSettings();
      const s = res.data;
      if (s.slaTiers && typeof D.SLA_TIERS !== 'undefined') {
        D.SLA_TIERS = {
          high: { fr: s.slaTiers.high.fr, ct: s.slaTiers.high.ct },
          medium: { fr: s.slaTiers.medium.fr, ct: s.slaTiers.medium.ct },
          low: { fr: s.slaTiers.low.fr, ct: s.slaTiers.low.ct },
        };
      }
      if (s.staleThresholds && typeof D.STALE_THRESHOLDS !== 'undefined') {
        D.STALE_THRESHOLDS = { high: s.staleThresholds.high, medium: s.staleThresholds.medium, low: s.staleThresholds.low };
      }
    } catch (e) { /* non-fatal: defaults remain */ }
  }
  global.syncSettingsFromServer = syncSettingsFromServer;

  // ── Override: persist SLA settings to the server ──
  const origSaveSLA = D.saveSLA;
  global.saveSLA = async function saveSLA() {
    if (typeof origSaveSLA === 'function') { try { origSaveSLA(); } catch (e) { /* keep going */ } }
    try {
      await API.updateSettings({ slaTiers: D.SLA_TIERS });
      await loadTicketsFromServer();
      toastSafe('SLA settings saved to server.', 'success');
    } catch (e) { toastSafe(`Could not save settings: ${e.message}`, 'error'); }
  };

  const origSaveStale = D.saveStaleThresholds;
  global.saveStaleThresholds = async function saveStaleThresholds() {
    if (typeof origSaveStale === 'function') { try { origSaveStale(); } catch (e) { /* keep going */ } }
    try {
      await API.updateSettings({ staleThresholds: D.STALE_THRESHOLDS });
      toastSafe('Stale thresholds saved to server.', 'success');
    } catch (e) { toastSafe(`Could not save thresholds: ${e.message}`, 'error'); }
  };

  // ── Override: wipe -> delete on the SERVER, then refresh ──
  // The original wipeDB only cleared local IndexedDB + in-memory state, so the
  // server copy survived and reloaded on the next page load. This makes the
  // "Wipe All Data" button actually purge MongoDB (admin+ only).
  global.wipeDB = async function wipeDB() {
    if (D.currentUser && !['admin', 'superadmin'].includes(D.currentUser.role)) {
      toastSafe('You do not have permission to wipe data.', 'error');
      return;
    }
    // eslint-disable-next-line no-alert, no-restricted-globals
    if (!confirm('PERMANENTLY delete ALL ticket data on the SERVER? This affects every user and cannot be undone.')) return;
    try {
      await API.wipeTickets();
    } catch (e) {
      toastSafe(`Server wipe failed: ${e.message}`, 'error');
      return;
    }
    // Clear the local cache too, then re-sync the (now empty) server state.
    try { if (typeof D.dbClear === 'function') await D.dbClear(); } catch (e) { /* non-fatal */ }
    D.masterData = [];
    D.filteredData = [];
    D.allCols = [];
    await loadTicketsFromServer();
    if (typeof D.updateHealthBar === 'function') D.updateHealthBar();
    toastSafe('All ticket data wiped from the server.', 'success');
  };

  // ── Boot: restore session on page load ──
  document.addEventListener('DOMContentLoaded', async () => {
    if (!API.isAuthed()) { showAuthScreen(); return; }
    try {
      const res = await API.me();
      applySession(res.data.user);
      showApp();
      await syncSettingsFromServer();
      await loadTicketsFromServer();
      if (typeof D.startSession === 'function') D.startSession();
    } catch (e) {
      API.clearToken();
      showAuthScreen();
    }
  });
}(window));
