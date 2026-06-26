# CNT Helpdesk: Bug Fix & Vercel + MongoDB Atlas Deployment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Patch 2 confirmed bugs and deploy the full-stack Express + MongoDB app to Vercel via GitHub with MongoDB Atlas as the database.

**Architecture:** Single Vercel serverless function (`api/index.js`) serves both the REST API (`/api/*`) and the static dashboard (`public/index.html`). MongoDB Atlas M0 (free tier) is the database. GitHub is the source-of-truth; Vercel auto-deploys on every push to `main`.

**Tech Stack:** Node.js 18+, Express 4, Mongoose 8, MongoDB Atlas M0, Vercel (serverless, `@vercel/node`), GitHub

## Global Constraints

- Node.js ≥ 18.x (enforced in `package.json` `engines` field)
- All secrets in environment variables — nothing sensitive committed
- `vercel.json` routes all traffic to `api/index.js`; do not change it
- Password minimum 12 characters enforced by validators
- No new dependencies; no new files beyond what's listed below

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Modify | `controllers/auditController.js` | Call `trimAudit()` fire-and-forget inside `listAudit` |
| Modify | `.env.example` | Add `SEED_TOKEN` and `SEED_ADMIN_PASS` entries |

All other files are unchanged.

---

### Task 1: Fix audit log trimming

**Files:**
- Modify: `controllers/auditController.js` (lines 9–12, the `listAudit` handler)

**What's broken:** `trimAudit()` is defined and exported but never invoked. The AuditLog collection will grow without bound in production. The fix is a single fire-and-forget call after the response is sent.

**Interfaces:**
- Produces: `listAudit` that self-trims the collection to ≤ 2000 rows on every admin fetch

- [ ] **Step 1: Open `controllers/auditController.js` and replace `listAudit`**

Current code (lines 9–12):
```js
const listAudit = asyncHandler(async (req, res) => {
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || '200', 10)));
  const entries = await AuditLog.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  return ok(res, entries);
});
```

Replace with:
```js
const listAudit = asyncHandler(async (req, res) => {
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || '200', 10)));
  const entries = await AuditLog.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  // Fire-and-forget: keep collection bounded; never let trim failure affect the response.
  trimAudit().catch(() => {});
  return ok(res, entries);
});
```

- [ ] **Step 2: Verify the file compiles (no syntax error)**

```bash
node --check controllers/auditController.js
```

Expected output: no output (Node exits 0 silently on success).

- [ ] **Step 3: Commit**

```bash
git add controllers/auditController.js
git commit -m "fix: call trimAudit() in listAudit to keep audit log bounded at 2000 rows"
```

---

### Task 2: Document missing env vars in .env.example

**Files:**
- Modify: `.env.example`

**What's missing:** `/api/seed-once` and `/api/reset-admin` in `routes/index.js` both check `req.headers['x-seed-token'] !== process.env.SEED_TOKEN` and use `process.env.SEED_ADMIN_PASS`. Neither is documented.

- [ ] **Step 1: Open `.env.example` and append the following block at the end**

Current last line ends after `PORT=3000`. Add:

```dotenv

# ─── Seed / Admin bootstrap ─────────────────────────────────
# Used by GET /api/seed-once and GET /api/reset-admin.
# SEED_TOKEN:     Any random string. Pass as header: x-seed-token: <value>
# SEED_ADMIN_PASS: Initial superadmin password (min 12 chars).
# Generate token: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
SEED_TOKEN=replace-with-a-random-string
SEED_ADMIN_PASS=replace-with-strong-password-min-12-chars
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add SEED_TOKEN and SEED_ADMIN_PASS to .env.example"
```

---

### Task 3: Push project to GitHub

No code changes. This task creates the remote repo and pushes all commits.

- [ ] **Step 1: Create a new private GitHub repo**

Go to https://github.com/new  
- Repository name: `cnt-helpdesk-fullstack` (or your preferred name)
- Visibility: **Private**
- Do NOT initialise with README, .gitignore, or licence (the project already has them)
- Click **Create repository**

- [ ] **Step 2: Initialise git locally if not already done**

Run from the project root (`project/` directory):
```bash
git init
git branch -M main
```

If `git init` says "Reinitialized existing Git repository" that's fine — skip to Step 3.

- [ ] **Step 3: Add .gitignore if it doesn't exist**

Check: `ls .gitignore`  
If missing, create it:
```
node_modules/
.env
uploads/*
!uploads/.gitkeep
```

- [ ] **Step 4: Stage and commit everything**

```bash
git add -A
git status
```

Verify `node_modules/` does NOT appear in the staged list (it should be gitignored). If it does appear, run `git rm -r --cached node_modules` first.

```bash
git commit -m "chore: initial full-stack project commit"
```

- [ ] **Step 5: Add remote and push**

Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username:
```bash
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/cnt-helpdesk-fullstack.git
git push -u origin main
```

Verify: refresh the GitHub repo page — all project files should be visible. Confirm `node_modules/` is absent.

---

### Task 4: Create MongoDB Atlas cluster and get connection string

No code changes. Manual steps in the Atlas UI.

- [ ] **Step 1: Log in and create a free cluster**

Go to https://cloud.mongodb.com  
- Click **Create** (or **Build a Database**)
- Choose **M0 Free** tier
- Select the cloud provider / region closest to you (or closest to Vercel's default: US East)
- Name the cluster (e.g. `cnt-helpdesk`) or leave the default
- Click **Create Deployment**

- [ ] **Step 2: Create a database user**

In the **Security Quickstart** (or **Database Access** → **Add New Database User**):
- Authentication method: **Password**
- Username: `cnt_app` (or your choice — remember it)
- Password: generate a strong password and save it somewhere safe
- Built-in role: **Read and write to any database**
- Click **Add User**

- [ ] **Step 3: Allow all IPs (required for Vercel)**

In **Network Access** → **Add IP Address**:
- Click **Allow Access from Anywhere** → this adds `0.0.0.0/0`
- Click **Confirm**

> Note: Vercel's IPs are not static, so `0.0.0.0/0` is required unless you subscribe to Vercel's fixed-IP add-on.

- [ ] **Step 4: Get the connection string**

In your cluster → **Connect** → **Drivers**:
- Driver: Node.js, version 5.5 or later
- Copy the connection string. It looks like:
  ```
  mongodb+srv://cnt_app:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=cnt-helpdesk
  ```
- Replace `<password>` with the database user password from Step 2
- Append the database name before the `?`: change `mongodb.net/` to `mongodb.net/cnt_helpdesk`

Final string:
```
mongodb+srv://cnt_app:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/cnt_helpdesk?retryWrites=true&w=majority&appName=cnt-helpdesk
```

Save this — you'll need it in Task 5.

- [ ] **Step 5: Generate a JWT secret**

Run this locally (Node.js required):
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copy the output (a 96-character hex string). Save it — you'll need it in Task 5.

- [ ] **Step 6: Generate a SEED_TOKEN**

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Save the output.

---

### Task 5: Create Vercel project and configure environment variables

No code changes. Manual steps in the Vercel UI.

- [ ] **Step 1: Import the GitHub repo into Vercel**

Go to https://vercel.com/new  
- Click **Continue with GitHub** and authorise Vercel if prompted
- Find `cnt-helpdesk-fullstack` in the repo list and click **Import**
- **Framework Preset:** leave as **Other** (Vercel will auto-detect it's not a Next.js app)
- **Root Directory:** leave blank (project root is the root)
- **Build Command:** leave blank (no build step needed)
- **Output Directory:** leave blank
- Do NOT click Deploy yet — go to Step 2 first

- [ ] **Step 2: Set all environment variables**

Click **Environment Variables** and add each one:

| Name | Value |
|------|-------|
| `MONGODB_URI` | The Atlas connection string from Task 4 Step 4 |
| `JWT_SECRET` | The 96-char hex string from Task 4 Step 5 |
| `JWT_EXPIRES_IN` | `8h` |
| `NODE_ENV` | `production` |
| `SEED_TOKEN` | The random string from Task 4 Step 6 |
| `SEED_ADMIN_PASS` | A strong password ≥ 12 characters (your choice — this becomes the admin password) |
| `CORS_ORIGINS` | Leave **blank** for now (you'll fill this in after first deploy in Task 6) |

For each variable: type the name, paste the value, leave the environment checkboxes as **Production + Preview + Development**, click **Add**.

- [ ] **Step 3: Deploy**

Click **Deploy**. Vercel will:
1. Clone the repo
2. Run `npm install`
3. Start `api/index.js` as a serverless function

Watch the build log. It should complete in under 2 minutes with no errors.

- [ ] **Step 4: Note your deployment URL**

After deploy, Vercel shows a URL like `https://cnt-helpdesk-fullstack-xxxx.vercel.app`. Copy it.

- [ ] **Step 5: Verify the API is alive**

Open a browser or run:
```bash
curl https://YOUR_VERCEL_URL.vercel.app/api/health
```

Expected response:
```json
{"success":true,"message":"API healthy","data":{"ts":"2026-06-26T..."}}
```

If you see this, the server is up and connected to MongoDB Atlas.

---

### Task 6: Set CORS_ORIGINS and seed the first admin

- [ ] **Step 1: Set CORS_ORIGINS in Vercel**

Go to your Vercel project → **Settings** → **Environment Variables**  
Find `CORS_ORIGINS` and set its value to your deployment URL (no trailing slash):
```
https://cnt-helpdesk-fullstack-xxxx.vercel.app
```

Click **Save**.

- [ ] **Step 2: Redeploy to pick up the new env var**

Go to **Deployments** → click the three-dot menu on the latest deployment → **Redeploy**.  
Wait for it to complete.

- [ ] **Step 3: Seed the superadmin account**

Run this curl command (replace the two placeholders):
```bash
curl -X GET \
  "https://YOUR_VERCEL_URL.vercel.app/api/seed-once" \
  -H "x-seed-token: YOUR_SEED_TOKEN"
```

Expected response:
```json
{"message":"Superadmin created","username":"admin"}
```

If you see `{"message":"Admin user already exists"}` — that's fine too, the account is ready.

- [ ] **Step 4: Open the dashboard and log in**

Open `https://YOUR_VERCEL_URL.vercel.app` in a browser.  
You should see the CNT Helpdesk login screen.

Log in with:
- **Username:** `admin`
- **Password:** the value you set for `SEED_ADMIN_PASS` in Task 5

If login succeeds and the dashboard loads — the deployment is complete.

- [ ] **Step 5: Smoke-test the key flows**

- [ ] Upload a Spiceworks CSV (drag-and-drop on the dashboard) → should show "X added, Y updated" toast
- [ ] Open the Users panel (admin only) → should list the admin user
- [ ] Open Settings → SLA tiers should be editable and save successfully
- [ ] Open Audit Log → should show the login entry
- [ ] Log out → should return to login screen; log back in → session restored

- [ ] **Step 6: Final commit confirming deployment**

```bash
git commit --allow-empty -m "chore: production deployment confirmed on Vercel + MongoDB Atlas"
git push origin main
```

---

## Verification Checklist

After Task 6 Step 5, every item below must be true:

- [ ] `/api/health` returns `{"success":true}`
- [ ] Login succeeds with the seeded admin account
- [ ] Dashboard loads with no console errors
- [ ] CSV upload persists tickets to MongoDB (re-login on another device and data is still there)
- [ ] SLA settings save and persist
- [ ] Audit log shows entries
- [ ] Logout works; re-login restores session from JWT
