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
      // Hydrate root-cause tags from the server so they persist across reloads
      // and devices (feeds the Recurring Issues view + Data Audit).
      const rc = {};
      all.forEach((t) => {
        if (t.rootCause && t.rootCause.cause) {
          rc[t.ticketId] = {
            cause: t.rootCause.cause,
            customText: t.rootCause.customText || '',
            user: t.rootCause.user || '',
            ts: t.rootCause.ts || new Date().toISOString(),
          };
        }
      });
      D._rootCauses = rc;
      if (typeof D.allCols !== 'undefined') {
        const cs = new Set();
        D.masterData.forEach((r) => Object.keys(r).filter((k) => !k.startsWith('_')).forEach((k) => cs.add(k)));
        D.allCols = [...cs];
      }
      // Pull server trend history so getSnapshots() (overridden below) is fresh
      // before the trend panel renders inside applyFilter().
      await syncSnapshotsFromServer();
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

  // ── Escape user-controlled text before inserting via innerHTML (XSS guard) ──
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ── Override: User Management -> MongoDB via /api/users ──
  // The original panel read/wrote localStorage (itd_users3); accounts created
  // there never reached the server. These overrides make the panel the real
  // user store backed by MongoDB.
  let _usersCache = [];

  global.renderUsers = async function renderUsers() {
    const body = $('userBody');
    if (!body) return;
    try {
      const res = await API.listUsers();
      _usersCache = res.data || [];
    } catch (e) {
      body.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text3);">Could not load users: ${esc(e.message)}</td></tr>`;
      return;
    }
    const meId = D.currentUser ? D.currentUser.id : null;
    const tagClass = (r) => (typeof D.roleTagClass === 'function' ? D.roleTagClass(r) : '');
    const tagLabel = (r) => (typeof D.roleLabel === 'function' ? D.roleLabel(r) : r);
    body.innerHTML = _usersCache.map((u) => {
      const created = (u.createdAt || '').slice(0, 10);
      const initial = esc((u.name || u.username || '?')[0].toUpperCase());
      // Don't allow deleting yourself or a superadmin from the table.
      const delBtn = (u._id === meId || u.role === 'superadmin')
        ? ''
        : `<button onclick="delUser('${u._id}')" class="btn btn-xs" style="background:var(--red-bg2);color:var(--red);border:1px solid var(--red-border);border-radius:6px;padding:4px 9px;font-size:.68rem;cursor:pointer;"><i class="fa fa-trash"></i></button>`;
      return `<tr>
        <td><div style="display:flex;align-items:center;gap:9px;"><div style="width:28px;height:28px;border-radius:50%;background:var(--red);color:#fff;font-size:.7rem;font-weight:800;display:flex;align-items:center;justify-content:center;">${initial}</div><span style="font-weight:600;">${esc(u.name || '(no name)')}</span></div></td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--text2);">${esc(u.username)}</td>
        <td><span class="role-tag ${tagClass(u.role)}">${esc(tagLabel(u.role))}</span></td>
        <td style="font-size:.74rem;color:var(--text3);">${esc(created)}</td>
        <td style="text-align:center;">
          <button onclick="editUser('${u._id}')" class="btn btn-ghost btn-xs" style="margin-right:4px;"><i class="fa fa-pen"></i></button>
          ${delBtn}
        </td>
      </tr>`;
    }).join('');
  };

  global.editUser = function editUser(id) {
    const u = _usersCache.find((x) => x._id === id);
    if (!u) return;
    D.editingUID = id;
    $('umTitle').textContent = 'Edit User';
    $('umSaveBtn').textContent = 'Save Changes';
    $('umName').value = u.name || '';
    $('umUser').value = u.username || '';
    $('umPass').value = '';
    $('umRole').value = u.role;
    $('umErr').style.display = 'none';
    if (typeof D.openModal === 'function') D.openModal('userModal');
  };

  global.saveUser = async function saveUser() {
    const name = $('umName').value.trim();
    const username = $('umUser').value.trim();
    const pass = $('umPass').value;
    const role = $('umRole').value;
    const err = $('umErr');
    const showErr = (m) => { err.textContent = m; err.style.display = 'block'; };
    err.style.display = 'none';
    if (!username) { showErr('Username is required.'); return; }
    try {
      if (D.editingUID) {
        // Username changes aren't supported server-side; role/name are.
        await API.updateUser(D.editingUID, { name, role });
        if (pass) {
          if (pass.length < 6) { showErr('Password must be at least 6 characters.'); return; }
          await API.resetUserPassword(D.editingUID, pass);
        }
        toastSafe('User updated.', 'success');
      } else {
        if (!pass || pass.length < 6) { showErr('A password of at least 6 characters is required for new users.'); return; }
        await API.createUser({
          username, password: pass, name, role,
        });
        toastSafe('User created.', 'success');
      }
    } catch (e) {
      showErr(e.message || 'Save failed.');
      return;
    }
    if (typeof D.closeModal === 'function') D.closeModal('userModal');
    await global.renderUsers();
  };

  global.delUser = async function delUser(id) {
    // eslint-disable-next-line no-alert, no-restricted-globals
    if (!confirm('Delete this user? This removes the account from the server.')) return;
    try {
      await API.deleteUser(id);
      toastSafe('User deleted.', 'success');
    } catch (e) {
      toastSafe(`Delete failed: ${e.message}`, 'error');
      return;
    }
    await global.renderUsers();
  };

  // ── Override: Audit log -> MongoDB via /api/audit ──
  const AUDIT_META = {
    login: { icon: 'fa-right-to-bracket', cls: 'log-login' },
    auth: { icon: 'fa-user-shield', cls: 'log-login' },
    upload: { icon: 'fa-cloud-arrow-up', cls: 'log-upload' },
    sla: { icon: 'fa-sliders', cls: 'log-sla' },
    user: { icon: 'fa-user-pen', cls: 'log-sla' },
  };
  function auditMeta(type) { return AUDIT_META[type] || { icon: 'fa-circle-info', cls: 'log-login' }; }

  global.renderAuditLog = async function renderAuditLog() {
    const el = $('auditLogList');
    if (!el) return;
    let entries = [];
    try {
      const res = await API.listAudit(200);
      entries = res.data || [];
    } catch (e) {
      el.innerHTML = `<div class="empty-sub" style="text-align:center;padding:20px;">Could not load audit log: ${esc(e.message)}</div>`;
      return;
    }
    if (!entries.length) { el.innerHTML = '<div class="empty-sub" style="text-align:center;padding:20px;">No activity recorded.</div>'; return; }
    el.innerHTML = entries.map((e) => {
      const m = auditMeta(e.type);
      const when = e.createdAt ? new Date(e.createdAt).toLocaleString() : '';
      return `<div class="log-item"><div class="log-icon ${m.cls}"><i class="fa ${m.icon}"></i></div><div><div class="log-msg">${esc(e.message)}</div><div class="log-ts">${esc(when)} | ${esc(e.actor || 'system')}</div></div></div>`;
    }).join('');
  };

  global.clearAuditLog = async function clearAuditLog() {
    // eslint-disable-next-line no-alert, no-restricted-globals
    if (!confirm('Clear the entire server audit log? This cannot be undone.')) return;
    try {
      await API.clearAudit();
      toastSafe('Audit log cleared.', 'success');
    } catch (e) {
      toastSafe(`Could not clear audit log: ${e.message}`, 'error');
      return;
    }
    global.renderAuditLog();
  };

  // ── Override: Trends/snapshots -> MongoDB via /api/snapshots ──
  // Server saves a daily snapshot on every upload / settings change. The client
  // just reads them; getSnapshots() returns this cache synchronously so the
  // existing trend-panel code works unchanged.
  let _snapshotsCache = [];
  async function syncSnapshotsFromServer() {
    try {
      const res = await API.listSnapshots(365);
      _snapshotsCache = (res.data || []).map((s) => ({
        date: s.date,
        slaScore: s.slaScore,
        grade: s.grade,
        openCount: s.openCount,
        breachCount: s.breachCount,
        staleCount: s.staleCount,
        highPct: s.highPct,
        medPct: s.medPct,
        lowPct: s.lowPct,
        ticketTotal: s.ticketTotal,
      }));
    } catch (e) { /* non-fatal: trend panel shows "building history" */ }
  }
  global.getSnapshots = function getSnapshots() { return _snapshotsCache; };
  // Server persists snapshots; the local writer becomes a no-op to avoid drift.
  global.saveDailySnapshot = function saveDailySnapshot() {};

  // ── Override: change own password -> server (/api/auth/change-password) ──
  // The original changePw only updated localStorage, so it never affected the
  // server-side login. This routes it through the API instead.
  global.changePw = async function changePw() {
    const cur = $('pwCur').value;
    const nw = $('pwNew').value;
    const cn = $('pwCon').value;
    if (!cur || !nw || !cn) { toastSafe('All fields required.', 'error'); return; }
    if (nw.length < 6) { toastSafe('New password must be at least 6 characters.', 'error'); return; }
    if (nw !== cn) { toastSafe('Passwords do not match.', 'error'); return; }
    try {
      await API.changePassword({ currentPassword: cur, newPassword: nw });
    } catch (e) {
      toastSafe(e.message || 'Could not change password.', 'error');
      return;
    }
    ['pwCur', 'pwNew', 'pwCon'].forEach((id) => { if ($(id)) $(id).value = ''; });
    toastSafe('Password changed.', 'success');
  };

  // ── Override: root-cause tagging -> MongoDB (persists on the ticket) ──
  // The original saveRootCause only wrote localStorage, which bridge never
  // restored on login, so tags appeared to vanish. This persists server-side.
  global.saveRootCause = async function saveRootCause() {
    const id = D.currentTicketID;
    if (!id) return;
    const cause = $('rcSelect').value;
    const customText = cause === 'Other' ? $('rcOther').value.trim() : '';
    if (cause === 'Other' && !customText) { toastSafe('Please describe the root cause.', 'error'); return; }
    try {
      await API.setRootCause(id, { cause, customText });
    } catch (e) {
      toastSafe(`Could not save root cause: ${e.message}`, 'error');
      return;
    }
    if (!cause) {
      delete D._rootCauses[id];
    } else {
      D._rootCauses[id] = {
        cause, customText, user: (D.currentUser && D.currentUser.name) || 'admin', ts: new Date().toISOString(),
      };
    }
    if (typeof D.renderRootCauseUI === 'function') D.renderRootCauseUI(id);
    if ($('pg-audit') && $('pg-audit').classList.contains('active') && typeof D.renderRaw === 'function') D.renderRaw();
    if ($('pg-recurring') && $('pg-recurring').classList.contains('active') && typeof D.renderRecurring === 'function') D.renderRecurring();
    toastSafe(cause ? 'Root cause saved.' : 'Root cause tag cleared.', 'success');
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
