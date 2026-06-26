# CNT IT Helpdesk Analytics Dashboard — Full-Stack (Express + MongoDB)

A production-ready full-stack version of the CNT Promo & Ads IT Helpdesk Analytics
Dashboard. The original single-file client app has been re-architected into a
secure Node.js + Express + MongoDB application deployable on Vercel, with shared
multi-user data, JWT authentication, role-based access control, and a faithful
server-side port of the SLA / grade engine.

---

## Table of contents
1. [Architecture](#architecture)
2. [Project structure](#project-structure)
3. [Prerequisites](#prerequisites)
4. [MongoDB setup](#mongodb-setup)
5. [Environment variables](#environment-variables)
6. [Local development](#local-development)
7. [Seeding the first admin](#seeding-the-first-admin)
8. [Vercel deployment](#vercel-deployment)
9. [API documentation](#api-documentation)
10. [Database schema](#database-schema)
11. [Security notes](#security-notes)

---

## Architecture

- **Frontend** — the original dashboard UI is preserved verbatim in `public/index.html`.
  Two small scripts (`public/js/api-client.js` and `public/js/bridge.js`) re-point
  authentication, ticket loading, CSV upload, and settings at the backend API
  instead of browser storage. All analytics rendering is unchanged.
- **Backend** — Express app (`app.js`) exposing a REST API under `/api`, backed by
  MongoDB via Mongoose. Tickets, users, settings, snapshots, and the audit log all
  live server-side so every technician sees the same data from any device.
- **SLA engine** — `utils/slaEngine.js` is a byte-for-byte port of the client
  business logic (SLA tiers, the GMT→UTC+8 shift, the column swap, breach-inclusive
  compliance, and the A-gate grade cap). Server and client therefore always agree.
- **Deployment** — a single Vercel serverless function (`api/index.js`) serves both
  the API and the static dashboard.

## Project structure

```
project/
├── api/
│   └── index.js          # Vercel serverless entry (exports the Express app)
├── config/
│   ├── db.js             # Cached Mongo connection (serverless-safe)
│   └── index.js          # Central config from env
├── controllers/          # Request handlers (auth, tickets, users, settings, audit)
├── middleware/           # auth (JWT+RBAC), validate, rateLimiters, errorHandler
├── models/               # Mongoose schemas (User, Ticket, Snapshot, AuditLog, Setting)
├── routes/               # Express routers, one per resource
├── utils/
│   ├── slaEngine.js      # Ported SLA / grade business logic
│   ├── apiResponse.js    # Standard JSON envelope + asyncHandler
│   └── seed.js           # First-admin seeder
├── public/               # Static dashboard (index.html + js/)
├── app.js                # Express app factory + middleware chain
├── server.js             # Local dev server
├── vercel.json           # Vercel routing
├── .env.example
└── README.md
```

## Prerequisites

- Node.js 18+ and npm
- A MongoDB database (MongoDB Atlas free tier is fine)
- A Vercel account (for deployment)

## MongoDB setup

1. Create a free cluster at <https://cloud.mongodb.com>.
2. Under **Database Access**, create a database user with a strong password.
3. Under **Network Access**, add `0.0.0.0/0` (or restrict to Vercel's ranges).
4. Click **Connect → Drivers** and copy the connection string. It looks like:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/cnt_helpdesk?retryWrites=true&w=majority`
5. Put it in `MONGODB_URI` (see below). The `cnt_helpdesk` path segment is the
   database name — keep or change it as you like.

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable        | Required | Description                                                        |
|-----------------|----------|--------------------------------------------------------------------|
| `MONGODB_URI`   | yes      | MongoDB Atlas connection string                                    |
| `JWT_SECRET`    | yes      | Long random string. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN`| no       | Token lifetime (default `8h`)                                      |
| `BCRYPT_ROUNDS` | no       | bcrypt cost factor (default `12`)                                  |
| `CORS_ORIGINS`  | no       | Comma-separated allowed origins; blank = reflect (dev only)        |
| `NODE_ENV`      | no       | `development` or `production`                                      |
| `PORT`          | no       | Local port (default `3000`)                                        |

## Local development

```bash
npm install
cp .env.example .env        # then edit .env
npm run dev                 # http://localhost:3000
```

The dashboard is served at `/` and the API at `/api`.

## Seeding the first admin

The very first registered account automatically becomes `superadmin`. You can
either register through the UI, or seed explicitly:

```bash
SEED_ADMIN_USER=admin SEED_ADMIN_PASS='YourStrongPassword123!' npm run seed
```

(Password must be at least 12 characters.)

## Vercel deployment

1. Push this repo to GitHub.
2. In Vercel, **New Project → Import** the repo.
3. Add the environment variables (`MONGODB_URI`, `JWT_SECRET`, `CORS_ORIGINS`
   set to your Vercel URL, `NODE_ENV=production`) under
   **Project → Settings → Environment Variables**.
4. Deploy. `vercel.json` routes everything to the serverless Express app.
5. After the first deploy, register the first account (it becomes superadmin) or
   run the seed locally against the same `MONGODB_URI`.

No build step is required — Vercel uses the `@vercel/node` runtime on
`api/index.js`.

## API documentation

All responses use the envelope:
```json
{ "success": true, "message": "OK", "data": { }, "meta": { } }
```
Authenticated routes require `Authorization: Bearer <token>`.

### Auth
| Method | Path                       | Role        | Body |
|--------|----------------------------|-------------|------|
| POST   | `/api/auth/register`       | public      | `{ username, password(≥12), name?, email? }` |
| POST   | `/api/auth/login`          | public      | `{ username, password }` |
| GET    | `/api/auth/me`             | any         | — |
| POST   | `/api/auth/change-password`| any         | `{ currentPassword, newPassword(≥12) }` |

### Tickets
| Method | Path                    | Role         | Notes |
|--------|-------------------------|--------------|-------|
| GET    | `/api/tickets`          | any          | Query: `priority,status,assignee,category,from,to,page,limit` |
| GET    | `/api/tickets/stats`    | any          | Server-computed scorecard + stale list |
| POST   | `/api/tickets/upload`   | itstaff+     | Multipart `file` or JSON `{ csv }`. Upserts by ticketId. |
| DELETE | `/api/tickets`          | admin+       | Wipe all tickets |

### Snapshots
| Method | Path              | Role | Notes |
|--------|-------------------|------|-------|
| GET    | `/api/snapshots`  | any  | Trend history (`limit` up to 365) |

### Users
| Method | Path                          | Role    | Body |
|--------|-------------------------------|---------|------|
| GET    | `/api/users`                  | admin+  | — |
| POST   | `/api/users`                  | admin+  | `{ username, password(≥12), role?, name?, email? }` |
| PATCH  | `/api/users/:id`              | admin+  | `{ role?, active?, name?, email? }` |
| POST   | `/api/users/:id/reset-password`| admin+ | `{ newPassword(≥12) }` |
| DELETE | `/api/users/:id`              | admin+  | — |

### Settings
| Method | Path             | Role    | Body |
|--------|------------------|---------|------|
| GET    | `/api/settings`  | any     | — |
| PUT    | `/api/settings`  | admin+  | `{ slaTiers?, staleThresholds? }` |

### Audit
| Method | Path          | Role        | Notes |
|--------|---------------|-------------|-------|
| GET    | `/api/audit`  | admin+      | Recent entries (`limit` up to 1000) |
| DELETE | `/api/audit`  | superadmin  | Clear the log |

### Health
| Method | Path           | Role   |
|--------|----------------|--------|
| GET    | `/api/health`  | public |

## Database schema

**User** — `username` (unique), `name`, `email`, `passwordHash` (bcrypt, never
returned), `role` (`viewer|itstaff|admin|superadmin`), `active`,
`failedLoginAttempts`, `lockUntil` (persisted brute-force lockout), `lastLoginAt`,
timestamps.

**Ticket** — `ticketId` (unique business key, enables upsert sync), raw source
fields (`summary, assignee, creator, organization, priority, category, status,
created, closeTimeSecsRaw, firstResponseSecsRaw`), derived fields (`date, frSecs,
ctSecs, frPass, ctPass` — **column swap** applied: source `close_time_secs` is the
real First Response, source `first_response_secs` is the real Resolution), `extra`
(map of any unmodelled columns), timestamps. Indexed on `ticketId, priority,
status, assignee, category, date` and the compound `{priority,status}`,
`{assignee,status}`.

**DailySnapshot** — one row per `date` (YYYY-MM-DD, unique): `slaScore, grade,
openCount, breachCount, staleCount, highPct, medPct, lowPct, ticketTotal`.

**AuditLog** — `type, message, actor, actorId, ip, meta`, timestamps; trimmed to
the most recent 2000 rows.

**Setting** — singleton (`key:"global"`): `slaTiers {high,medium,low}{fr,ct}` and
`staleThresholds {high,medium,low}`.

## Security notes

- Passwords hashed with bcrypt (cost 12); password hashes never leave the server.
- JWT auth; tokens verified against a live, active user on every request.
- RBAC enforced server-side on every privileged route (not just hidden in the UI).
- Persisted login lockout (5 failures → 15-minute lock) survives refresh and
  device switches.
- `express-mongo-sanitize` strips `$`/`.` keys to defeat NoSQL injection.
- `helmet` security headers, `compression`, and a strict CORS allowlist in prod.
- Rate limiting: aggressive on auth endpoints, general on the rest.
- All secrets come from environment variables; nothing sensitive is committed.

---

© CNT Promo & Ads Specialists Inc. Internal use.
