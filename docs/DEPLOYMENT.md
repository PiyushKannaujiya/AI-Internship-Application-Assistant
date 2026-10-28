# Deployment Guide — Atlas + Render + Vercel

This guide prepares the app for a free-tier deployment. **No deployment was
performed in this session** because no account access was available. Do not
consider the app deployed until you complete these steps and test the live URLs.

Official references used for this configuration:

- [Render Blueprint YAML reference](https://render.com/docs/blueprint-spec)
- [Render free instances](https://render.com/docs/free)
- [Render web services and port binding](https://render.com/docs/web-services)
- [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel rewrites](https://vercel.com/docs/routing/rewrites)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [MongoDB Atlas free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)

## Target architecture

```text
Browser
  ├─ Vercel: React/Vite static site  ── https://YOUR-APP.vercel.app
  └─ fetch + Bearer JWT
        └─ Render: Express API ──────── https://YOUR-API.onrender.com
              └─ MongoDB Atlas free cluster
                    └─ users, jobs, applications, private resume documents
```

The backend is the only component that knows `MONGO_URI`, `JWT_SECRET`, and any
AI key. The Vercel app receives only `VITE_API_URL`.

## 0. Prerequisites

- GitHub repository connected to Render and Vercel
- MongoDB Atlas account
- Render account
- Vercel account
- Optional: an AI provider API key if you want real AI drafts

## 1. MongoDB Atlas free cluster

1. Create an Atlas project and a **Free (M0)** cluster. Choose a region near the
   Render region you plan to use (Render's default free region is Oregon).
2. Under **Database Access**, create a dedicated application user with a long
   random password. Use the narrowest role your Atlas tier supports:
   - preferred: a `readWrite` role scoped to the application database only;
   - if your tier's UI only offers broad built-in roles, use
     `readWriteAnyDatabase` for a dedicated app user — never an Atlas admin user.
3. Under **Network Access**, allow Render's outbound traffic. Render free
   services do not provide static outbound IPs, so you may need
   `0.0.0.0/0` with a strong database password and TLS. For tighter access,
   upgrade to a plan with static outbound IPs and allow only those addresses.
4. Copy the SRV connection string. URL-encode special characters in the
   password and include a database name, for example:

```text
mongodb+srv://appuser:ENCODED_PASSWORD@cluster0.xxxxx.mongodb.net/ai_internship?retryWrites=true&w=majority
```

5. Keep the URI out of Git and out of the browser.

Atlas free-tier limits that matter:

- 0.5 GB data storage including indexes; not configurable or auto-expanded.
- 10 GB inbound / 10 GB outbound per rolling seven days.
- Up to 500 collections, 100 databases, 500 connections.
- About 100 read/write operations per second.
- Free clusters can pause after 30 days with no connections; resume them in the
  Atlas UI if the API suddenly cannot connect.

A 5 MB resume stored in MongoDB uses space in this limit. Delete old resumes via
the app when replacing work; the app supports one resume per account.

## 2. Render backend

### Option A — Blueprint (recommended)

The repo contains `render.yaml` at the root. It defines:

- `rootDir: server`
- `buildCommand: npm ci`
- `startCommand: npm start`
- `healthCheckPath: /api/health`
- `plan: free`
- secret values with `sync: false` (you enter them in the dashboard)
- a generated `JWT_SECRET`

In Render: **New → Blueprint**, connect the repository, and apply the Blueprint.

### Option B — manual web service

- Runtime: Node
- Root directory: `server`
- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/api/health`
- Instance type: Free

### Environment variables

Set these in **Render → Service → Environment** (not in Git):

| Key | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGO_URI` | Atlas SRV URI from step 1 |
| `JWT_SECRET` | 64+ random hex characters |
| `CLIENT_URL` | Your exact Vercel URL, e.g. `https://ai-internship.vercel.app` |
| `JWT_EXPIRES_IN` | `7d` |
| `BCRYPT_ROUNDS` | `12` |
| `UPLOAD_MAX_BYTES` | `5242880` |
| `AI_PROVIDER` | `none` or `openai` |
| `AI_API_KEY` | only if AI is enabled |
| `AI_BASE_URL` | `https://api.openai.com/v1` or a compatible gateway |
| `AI_MODEL` | e.g. `gpt-4o-mini` |
| `AI_TIMEOUT_MS` | `30000` |
| `JOBS_API_URL` | `https://remotive.com/api/remote-jobs` |
| `JOB_DISCOVERY_SOURCES` | `remotive,jobicy,arbeitnow,adzuna` (add `remoteok` and board sources once configured) |
| `JOB_SOURCE_TIMEOUT_MS` | `8000` |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | free keys from api.adzuna.com; omit to skip the source cleanly |
| `ADZUNA_COUNTRY` | `in` (India index) |
| `GREENHOUSE_BOARDS` | optional, e.g. `stripe,figma` |
| `LEVER_SITES` | optional, e.g. `spotify` |
| `ASHBY_ORGS` | optional, e.g. `notion,ramp` |
| `URL_IMPORT_TIMEOUT_MS` | `10000` |
| `URL_IMPORT_MAX_BYTES` | `2097152` |
| `URL_IMPORT_MAX_REDIRECTS` | `3` |

Do **not** set `URL_IMPORT_ALLOW_HTTP` or `URL_IMPORT_ALLOW_PRIVATE_HOSTS` in
production: both are development/test escape hatches that weaken SSRF
protection, and the environment schema refuses to start with them enabled when
`NODE_ENV=production`.

Generate a JWT secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Notes:

- Do **not** set `PORT` manually. Render injects it. The server listens on
  `0.0.0.0` and the supplied port.
- `CLIENT_URL` accepts comma-separated exact origins, with no trailing slash.
  Add a Vercel preview origin only if you need preview deployments to call the
  API, e.g. `https://app.vercel.app,https://app-git-main-you.vercel.app`.
- Changing `CLIENT_URL` restarts the service and updates CORS.
- If you deploy the API before the frontend, use a valid placeholder such as
  `https://example.vercel.app`, then replace it with the real Vercel URL.

### Free-tier behavior

- The service spins down after 15 minutes without traffic.
- The next request wakes it; startup can take about a minute. The browser may
  see a fetch failure or a gateway error during that first request; retry.
- Free instances have 0.1 CPU and 512 MB RAM.
- The filesystem is ephemeral. This app avoids the issue by storing resumes in
  MongoDB instead of local disk.
- Free services cannot attach persistent disks.
- The app enforces its own resume limit (`UPLOAD_MAX_BYTES`, default 5 MB).
  Render does not document a general free-tier request-body limit, so the app
  limit is the effective contract.

## 3. Vercel frontend

1. **New Project → Import** the same repository.
2. Set **Root Directory** to `client`.
3. Vercel auto-detects Vite. Confirm:
   - Framework preset: Vite (or auto-detected)
   - Install command: `npm ci`
   - Build command: `npm run build`
   - Output directory: `dist`
4. Add a Production environment variable:
   - `VITE_API_URL` = `https://YOUR-RENDER-SERVICE.onrender.com/api`
   - Include `/api`; no trailing slash.
5. Deploy.
6. Copy the Vercel production URL back into Render's `CLIENT_URL`.
7. Redeploy the frontend after changing `VITE_API_URL`, because Vite variables
   are baked in at build time.

`client/vercel.json` supplies the SPA fallback rewrite so deep links such as
`/jobs/abc` load the React app. It also sets basic security headers.

Do not put backend secrets in Vercel variables. Only `VITE_*` public values
belong there.

## 4. Post-deployment verification

Replace the URLs with your real ones.

```bash
# 1. Liveness
curl -i https://YOUR-API.onrender.com/api/health

# 2. Readiness (database connected)
curl -i https://YOUR-API.onrender.com/api/health/ready

# 3. CORS preflight for the frontend origin
curl -i -X OPTIONS https://YOUR-API.onrender.com/api/auth/login \
  -H "Origin: https://YOUR-APP.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"

# 4. CORS rejection for an unknown origin (expect 403)
curl -i https://YOUR-API.onrender.com/api/health \
  -H "Origin: https://evil.example"
```

Then test in a browser at the Vercel URL:

1. Register a new account and confirm you land in the dashboard.
2. Refresh the page and confirm the session restores.
3. Complete profile fields and save; confirm projects, certifications,
   achievements, saved answers, and work authorization persist. Approve one
   saved answer and confirm only that answer appears in the application preview.
4. Upload a text-based PDF or DOCX; confirm parsed skills appear. Open **Review
   extracted profile data**, confirm conflicts are shown, apply once without the
   overwrite box (existing values must stay), then apply with it ticked.
5. Add a manual job with a real application URL.
6. Open job detail; confirm match score, matched/missing skills, and reasons.
7. Generate a cover letter. If AI is off, verify it says `Template` and shows a
   notice; if AI is on, verify it says `AI generated`.
8. Open the application preview; verify only your own profile values appear and
   the submit button stays disabled until the approval checkbox is checked.
9. Do not check the box unless you actually submitted the real application.
10. Change statuses on the Applications page and confirm the dashboard updates.
11. Try **Discover live**; confirm listings load from Remotive, Jobicy, and
    Arbeitnow, and that each card shows its source. Tick Remote OK and confirm
    its cards and attribution appear too. Set location to `india` and confirm
    only India-matching listings remain (or an honest empty state). If one
    provider is down, the others must still render and a per-source warning
    must appear.
12. Name a Greenhouse/Lever/Ashby board and search again; confirm those listings
    appear. Remove the board and confirm a clear "no boards configured" notice
    instead of fake results.
13. Paste a public job URL into **Paste a job link**; confirm either an extracted
    draft or the manual-import fallback appears. Confirm private/loopback URLs
    are rejected with `URL_BLOCKED`.
14. Open a job and click **Tailored resume**. Generate a revision; confirm the
    diff lists omitted unverified claims, download both PDF and DOCX, edit the
    summary, and confirm the files rebuild. Approve it, then open the application
    preview and confirm only the approved revision is offered.
15. Sign out; confirm protected routes redirect to login.

Only after these checks should you call the deployment working.

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| First request times out or fails | Render free service asleep | Wait/retry; cold start can take ~1 minute |
| API returns 503 from `/health/ready` | MongoDB not connected | Check `MONGO_URI`, Atlas user password encoding, Atlas network access, paused cluster |
| Browser shows CORS error | `CLIENT_URL` mismatch | Set exact Vercel origin(s), no trailing slash, redeploy/restart Render |
| Login works in curl but not browser | Preflight blocked | Verify origin and `Authorization` allowed; check 403 on OPTIONS |
| 401 immediately after deploy | `JWT_SECRET` changed or missing | Set a stable secret; changing it revokes all sessions |
| Signup 500 | Database unreachable or indexes conflicting | Inspect Render logs (no secrets), verify Atlas access and region |
| `MONGO_URI is required in production` | Env var missing | Add it in Render and redeploy |
| Upload 413 | File above `UPLOAD_MAX_BYTES` | Use a smaller file or raise the limit carefully below 16 MB |
| Upload 422 | Scanned/image-only PDF or unreadable DOCX | Upload a text-based PDF/DOCX |
| Frontend routes 404 on refresh | SPA rewrite missing | Ensure Vercel root is `client` and `vercel.json` is deployed |
| Frontend calls localhost in production | `VITE_API_URL` missing at build time | Add variable and redeploy |
| AI button returns template | No AI key, provider timeout, rate limit, bad output | Expected fallback; check `AI_PROVIDER`, key, base URL, model |
| Live discovery 503 | Every requested source unreachable or blocking egress | Retry later, request fewer sources, or add jobs manually |
| Discover returns 0 jobs | Location/work-mode/job-type filter matched nothing | Clear the filters; an empty set with every source `ok` is no matches, not a failure |
| URL import 400 `URL_BLOCKED` | Non-HTTPS scheme, reserved host, credentials, unusual port, or private DNS answer | Use the public HTTPS page; open it in your browser and add the job manually if it cannot be read |
| URL import 502/504 | Page unreachable, TLS failure, too many redirects, or timeout | Retry, or use the manual-import fallback |
| URL import 415 | URL does not serve HTML | Use the job posting page itself, not a PDF or API endpoint |
| Resume missing after redeploy | Old version wrote to local disk | This version stores files in MongoDB; re-upload once |
| Atlas cluster paused | 30 days without connections | Resume the cluster in Atlas |

## 6. Secret rotation

- `JWT_SECRET`: change in Render; all existing sessions are invalidated because
  signatures no longer verify.
- `MONGO_URI`: rotate the Atlas user password, update Render, redeploy.
- `AI_API_KEY`: rotate in the provider dashboard, update Render only.
- Never rotate values by committing them. Never paste real values into issues,
  screenshots, logs, or chat.

## 7. Rollback

Render keeps deployment history; roll back to the previous successful deploy if
a release breaks startup. Database schema changes in this project are additive
and index-based, so a short rollback window is safe. Always test a rollback
against a staging database before relying on it in production.

## 8. What still requires your action

- Create the three accounts and set the values above.
- Complete the browser checklist.
- Enable AI only after reviewing provider cost and data-retention terms.
- Add a custom domain if desired and update CORS.
- Set up uptime monitoring if cold starts are unacceptable; a paid Render
  instance or scheduled ping can keep the service warm.
