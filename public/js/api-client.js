/**
 * CNT Helpdesk API client.
 * Thin wrapper over fetch that injects the JWT, parses the standard envelope,
 * and exposes typed helpers for every backend endpoint. Loaded before the
 * dashboard logic so `window.API` is available everywhere.
 */
(function apiClient(global) {
  'use strict';

  const TOKEN_KEY = 'cnt_jwt';
  const USER_KEY = 'cnt_user';

  function getToken() { return localStorage.getItem(TOKEN_KEY) || null; }
  function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }

  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; }
  }
  function setUser(u) { if (u) localStorage.setItem(USER_KEY, JSON.stringify(u)); }

  async function request(path, { method = 'GET', body, isForm = false, auth = true } = {}) {
    const headers = {};
    if (!isForm) headers['Content-Type'] = 'application/json';
    if (auth) {
      const t = getToken();
      if (t) headers.Authorization = `Bearer ${t}`;
    }
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: isForm ? body : (body ? JSON.stringify(body) : undefined),
    });

    let json;
    try { json = await res.json(); } catch (e) { json = { success: false, message: `HTTP ${res.status}` }; }

    if (res.status === 401 && auth) {
      // Token invalid/expired - force re-login.
      clearToken();
      if (global.onAuthExpired) global.onAuthExpired();
    }
    if (!json.success) {
      const err = new Error(json.message || 'Request failed');
      err.status = res.status;
      err.errors = json.errors;
      throw err;
    }
    return json;
  }

  const API = {
    getToken, setToken, clearToken, getUser, setUser,
    isAuthed: () => !!getToken(),

    // ── Auth ──
    register: (data) => request('/auth/register', { method: 'POST', body: data, auth: false }),
    login: (data) => request('/auth/login', { method: 'POST', body: data, auth: false }),
    me: () => request('/auth/me'),
    changePassword: (data) => request('/auth/change-password', { method: 'POST', body: data }),

    // ── Tickets ──
    listTickets: (query = {}) => {
      const qs = new URLSearchParams(query).toString();
      return request(`/tickets${qs ? `?${qs}` : ''}`);
    },
    uploadCsvText: (csv) => request('/tickets/upload', { method: 'POST', body: { csv } }),
    uploadCsvFile: (file) => {
      const fd = new FormData();
      fd.append('file', file);
      return request('/tickets/upload', { method: 'POST', body: fd, isForm: true });
    },
    getStats: () => request('/tickets/stats'),
    wipeTickets: () => request('/tickets', { method: 'DELETE' }),

    // ── Snapshots ──
    listSnapshots: (limit = 180) => request(`/snapshots?limit=${limit}`),

    // ── Users ──
    listUsers: () => request('/users'),
    createUser: (data) => request('/users', { method: 'POST', body: data }),
    updateUser: (id, data) => request(`/users/${id}`, { method: 'PATCH', body: data }),
    resetUserPassword: (id, newPassword) => request(`/users/${id}/reset-password`, { method: 'POST', body: { newPassword } }),
    deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),

    // ── Settings ──
    getSettings: () => request('/settings'),
    updateSettings: (data) => request('/settings', { method: 'PUT', body: data }),

    // ── Audit ──
    listAudit: (limit = 200) => request(`/audit?limit=${limit}`),
    clearAudit: () => request('/audit', { method: 'DELETE' }),
  };

  global.API = API;
}(window));
