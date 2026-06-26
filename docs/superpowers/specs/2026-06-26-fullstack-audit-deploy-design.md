# CNT Helpdesk Full-Stack: Audit & Deploy Design
**Date:** 2026-06-26  
**Scope:** Fix 2 confirmed bugs, update .env.example, deploy to Vercel + MongoDB Atlas via GitHub

---

## What Already Works

The project is a complete full-stack Express + MongoDB app. All routes, controllers, models, middleware, auth, RBAC, security headers, SLA engine, bridge scripts, and Vercel config are correct and require no changes.

---

## Bug Fixes (2 files)

### 1. `auditController.js` — trimAudit never called
`trimAudit()` is exported but never invoked, so the AuditLog collection grows without bound.  
**Fix:** Call `trimAudit()` (fire-and-forget, swallow error) at the end of `listAudit`.

### 2. `.env.example` — missing SEED_TOKEN and SEED_ADMIN_PASS
`routes/index.js` exposes `/api/seed-once` and `/api/reset-admin`, both gated by `process.env.SEED_TOKEN`. Neither var is documented in `.env.example`.  
**Fix:** Add both entries with inline comments.

---

## Deployment Sequence

1. **GitHub** — push the project to a new private GitHub repo
2. **MongoDB Atlas** — create a free M0 cluster, database user, allow all IPs (`0.0.0.0/0`), copy connection string
3. **Vercel** — import the GitHub repo, set env vars:
   - `MONGODB_URI` — Atlas connection string
   - `JWT_SECRET` — 48-byte hex random string
   - `JWT_EXPIRES_IN` — `8h`
   - `CORS_ORIGINS` — Vercel deployment URL (set after first deploy)
   - `NODE_ENV` — `production`
   - `SEED_TOKEN` — random string (protects seed endpoint)
   - `SEED_ADMIN_PASS` — strong password ≥12 chars
4. **Deploy** — trigger deploy, verify `/api/health` returns `{"success":true}`
5. **Seed** — `GET /api/seed-once` with `x-seed-token` header → creates superadmin
6. **CORS fix** — update `CORS_ORIGINS` to actual Vercel URL, redeploy

---

## Out of Scope

- No new features
- No test suite
- No schema changes
- No frontend changes
