# ApplyPilot — AI Internship Application Assistant

A full-stack internship search workspace: private resume parsing, job tracking,
explainable match scores, AI-assisted drafts with a template fallback, and a
manual, approval-gated application workflow.

> **Deployment status:** The application has **not** been deployed by this
> session because no Render, Vercel, MongoDB Atlas, or AI-provider credentials
> were available. All deployment configuration and instructions are included.
> Test and build results are reported in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## What is implemented

| Area | Status | Notes |
| --- | --- | --- |
| Email/password auth | Working | bcrypt hashing, JWT access tokens, token-version revocation on logout/password change |
| Profile | Working | Skills, education, experience, projects (technologies + verified accomplishments), certifications, achievements, an approval-gated answer bank, work authorization, preferred roles/locations, job preferences, completeness score |
| Resume management | Working | PDF/DOCX upload, magic-byte validation, private MongoDB storage, text/skill parsing, replace, download, delete, and a reviewable extraction endpoint that protects verified profile values |
| Tailored resumes | Working | Job-specific revisions built only from verified profile data, PDF + DOCX stored separately, diff against the original profile, editing, regeneration, explicit approval, and owner-only downloads. Only approved revisions are offered in the application preview. |
| Job management | Working | Manual jobs, search, filters, sorting, pagination, save/bookmark, duplicate prevention |
| Live job discovery | Working | Ten source adapters (Remotive, Jobicy, Arbeitnow, Greenhouse, Lever, Ashby, Remote OK, **Adzuna's official India jobs API**, **Workable public account feeds**, and **SmartRecruiters public job-board pages** — ATS feeds where you supply the account/board id; targeted boards live-verified 2026-10-28, e.g. `linkedin3`, `WNSGlobalServices144`, `WesternDigital` on SmartRecruiters and `exponent-energy` on Workable) — skipped with a clear `not_configured` note until `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` are set) with per-source isolation, cross-source dedupe, caching, attribution, location/remote/job-type filters (location=india matches Indian metros and states), **India-default location and India-first ranking when no location filter is set**, and honest 503s when every source fails. Import by provider id. |
| Platform search shortcuts | Working | LinkedIn, Internshala, Naukri, Wellfound, Unstop, Cutshort, and Foundit expose no permitted public listing API, so they cannot appear in live results. Every discovery response carries verified prefilled search URLs (`shortcuts`) that open the platform's own listings with your keyword, location (LinkedIn/Naukri/Foundit support internship filters: `f_JT=I`, internship slugs, `/jobtype/internship`), and remote flags applied where the platform supports it. Each shortcut is labeled "platform search · not a live feed". Internshala's keyword search is a form POST, so its shortcut opens verified listing pages (remote/city) instead of a fake query URL. All URL shapes were re-probed live on 2026-10-25 (every one answered HTTP 200; the Adzuna endpoint answered 401 with dummy credentials, its documented contract) — see [docs/VERIFICATION.md](docs/VERIFICATION.md). |
| URL job import | Working | Public job-page extraction (schema.org JobPosting, then metadata) with SSRF protection, redirect re-validation, size/time caps, and a manual-import fallback. No platform API, no login/CAPTCHA bypass. |
| Application tracking | Working | Saved → planned → in progress → submitted → interview / rejected / offer, history, notes |
| Explainable matching | Working | Deterministic weighted score with matched/missing skills, experience, role, location, reasons |
| AI drafts | Configurable | OpenAI-compatible provider; strict output validation; clearly labeled template fallback with no key |
| Application workflow | Working (manual) | Verified prefill preview, editable cover letter, copy helpers, explicit approval before recording submission. |
| Application readiness | Working | Ready for Review checklist: approved job-specific resume and files, missing profile fields, cover-letter requirement, approved screening answers, unverified claims, adapter support, and a human-submission guard. Read-only; never changes status. |
| Browser-assisted autofill | Working (local helper) | Visible Playwright CLI fills supported forms from verified values, attaches the approved PDF/DOCX, fills saved cover letters and approved answers, reports missing/validation/unsupported controls, and never clicks a submit control. Greenhouse, Lever, and Ashby adapters; everything else is manual fallback. Live runs on real public Greenhouse, Lever, and Ashby application forms filled mapped fields, attached the approved PDF, detected invisible bot-protection scripts without touching them, and left every submission control untouched. See [docs/AUTOFILL.md](docs/AUTOFILL.md). |
| Dashboard | Working | Real API data, status pipeline, recommendations, activity, completion, loading/empty/error states |
| Tests | Working | 123 backend tests (API + source adapters + URL import/SSRF + profile/extraction review + tailored resumes + readiness/autofill + live Playwright fixtures) and 10 frontend flow tests (see verification doc) |
| API docs | Working | Swagger UI at `/api/docs`, OpenAPI 3 at `/api/openapi.json`, source in `server/openapi.yaml` |

## Important boundaries

- **No fabricated qualifications in tailored resumes.** Generation copies only
  stored profile data, keeps skills that already exist, and omits accomplishments
  that are not marked verified. The original uploaded resume is never modified;
  regeneration creates a new revision, and approved revisions are locked.
- **No silent profile overwrite.** Resume extraction is a review, not an
  import. Existing profile values are only replaced when the user explicitly
  opts in; everything else is reported as skipped. Answer-bank entries are only
  offered in previews after explicit approval.
- **No automatic submission.** The backend has no code that submits a form on an
  employer site. The local autofill helper has no click call, performs no
  submit/request, scans final controls only to report them, and leaves the browser
  open. "Submitted" is set only through a dedicated endpoint that requires
  `approved: true`, `confirmation: true`, after the user submits the form
  themselves.
- **No guessed values in autofill.** The plan uses the account, the verified
  profile, an **approved** tailored revision, and explicitly approved saved
  answers. Draft resumes, unverified accomplishments, and unapproved answers are
  excluded. Missing fields are reported, not invented.
- **No CAPTCHA/OTP/MFA/login handling in the helper.** It detects those gates and
  stops before filling. Unsupported portals (LinkedIn, Workday, unknown hosts)
  return manual-fallback instructions instead of selectors guessed at runtime.
- **No CAPTCHA/MFA/anti-bot bypass.** There is no LinkedIn, Naukri, Internshala, Wellfound, Indeed, Foundit, Cutshort, or Unstop automation — none of them offers a permitted public job API. The safe
  workflow opens the employer page in a normal browser tab and provides verified
  values to paste.
- **No fabricated AI results.** When no AI key is configured, responses are
  marked `provider: "template"` with an explicit notice. When the provider fails,
  the app returns a template fallback plus the failure reason, not a fake success.
- **No invented jobs.** Live discovery reads only public source APIs. A failed
  source is reported by name; the API returns 503 only when every requested
  source fails, and never returns sample data.
- **No fake platform integrations.** LinkedIn, Internshala, Naukri, Wellfound,
  Unstop, Cutshort, and Foundit have no permitted public job API for third
  parties, so they never appear in live discovery results. Instead you get:
  (a) verified platform search shortcuts that open their own listings,
  (b) `POST /jobs/import-url` which reads the public page you can already open
  and falls back to a manual form when the page cannot be read, and
  (c) **Adzuna's official India jobs API** as a live integrated source after
  you add its free developer keys.
- **No SSRF.** URL import requires HTTPS by default, validates DNS answers,
  blocks loopback/private/reserved addresses, pins the validated address,
  re-validates every redirect, and caps time and response size.
- **No live deployment was performed.** See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Architecture

```text
client/                     React 19 + Vite SPA
  src/api/client.js         API client, JWT header, normalized errors
  src/context/              auth/session context
  src/components/           layout, icons, feedback, match score UI
  src/pages/                dashboard, jobs, applications, resume, profile, auth
  src/__tests__/            Vitest + Testing Library flows

server/                     Express 5 API (ES modules)
  src/config/               env validation, MongoDB connection
  src/models/               User, Resume, Job, Application, Activity
  src/controllers/          HTTP handlers
  src/services/             parsing, matching, AI, job sources, URL import, activity
  src/services/jobSources/  one adapter per provider + registry/orchestrator
  src/services/urlImport/   safe page fetcher + JobPosting/metadata extractor
  src/services/autofill/    portal adapters, no-submit guard, plan builder
  src/services/readiness.js Ready for Review evaluation (read-only)
  src/middleware/           auth, validation, limits, uploads, errors, logging
  src/routes/               auth, users, resumes, jobs, applications, ai, autofill, dashboard
  src/validators/           zod schemas
  tests/                    node:test + supertest + in-memory MongoDB + Playwright fixture
  openapi.yaml              OpenAPI 3 specification

tools/autofill/             Local visible Playwright helper (optional dependency)
  cli.js                    plan fetch, approved resume download, visible run
  lib/                      guard, plan, detection, fill, session, reporting

docs/                       deployment, security, API, autofill, verification
render.yaml                 Render Blueprint
```

The frontend and backend are separate applications with separate environment
files. The frontend never receives the MongoDB URI, JWT secret, or AI key.

## Local setup

Prerequisites:

- Node.js 20.19+ (Node 22 LTS recommended)
- npm 10+
- A MongoDB Atlas connection string, or a local MongoDB instance

```bash
# 1. Install dependencies
npm run install:all

# 2. Configure the backend
cp server/.env.example server/.env
# Edit server/.env and set MONGO_URI and a long JWT_SECRET

# 3. Configure the frontend (optional; defaults to localhost:5000/api)
cp client/.env.example client/.env

# 4. Start the API and SPA in separate terminals
npm run dev:server
npm run dev:client
```

Open `http://localhost:5173`.

Generate a JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Required environment variables (backend)

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGO_URI` | Yes | MongoDB Atlas/local connection string |
| `JWT_SECRET` | Yes in production | Signs access tokens; minimum 32 chars in production |
| `CLIENT_URL` | Yes | Comma-separated allowed origins, no trailing slash |
| `PORT` | No (5000) | Hosting platform supplies it in production |
| `NODE_ENV` | No | `development`, `test`, or `production` |
| `JWT_EXPIRES_IN` | No (7d) | Access-token lifetime |
| `BCRYPT_ROUNDS` | No (12) | Password hashing cost |
| `UPLOAD_MAX_BYTES` | No (5 MB) | Maximum resume size |
| `AI_PROVIDER` | No (`none`) | `none` or `openai` |
| `AI_API_KEY` | Only for AI | Kept server-side only |
| `AI_BASE_URL` | No | Any OpenAI-compatible `/v1` endpoint |
| `AI_MODEL` | No | Provider model id |
| `AI_TIMEOUT_MS` | No (30000) | Provider timeout |
| `JOBS_API_URL` | No | Remotive API URL |
| `JOB_DISCOVERY_SOURCES` | No (`remotive`) | Comma-separated default sources |
| `JOB_SOURCE_TIMEOUT_MS` | No (8000) | Per-source timeout |
| `GREENHOUSE_BOARDS` / `LEVER_SITES` / `ASHBY_ORGS` | No | Company boards for target-based sources |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | No | Free developer keys from api.adzuna.com; enables the official India jobs source |
| `ADZUNA_COUNTRY` | No (`in`) | Adzuna country index (ISO code) |
| `URL_IMPORT_TIMEOUT_MS` | No (10000) | Page fetch deadline |
| `URL_IMPORT_MAX_BYTES` | No (2 MB) | HTML size cap |
| `URL_IMPORT_MAX_REDIRECTS` | No (3) | Redirect hops, each re-validated |
| `URL_IMPORT_ALLOW_HTTP` | No (`false`) | Dev/test only; rejected in production |
| `URL_IMPORT_ALLOW_PRIVATE_HOSTS` | No (`false`) | Dev/test only; rejected in production |

Frontend:

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | Yes in production | Backend base URL including `/api` |

Never commit `.env` files. The repository ignores them, including every
`.env.*` file except `.env.example`.

## Commands

```bash
# Install
npm run install:all

# Development
npm run dev:server        # http://localhost:5000
npm run dev:client        # http://localhost:5173

# Tests
npm test                  # backend + frontend
npm run test:server
npm run test:client

# Optional local autofill helper (not required by the server or client)
npm run autofill:install  # install Playwright + Chromium in tools/autofill
npm run autofill -- --help

# Production frontend build
npm run build

# Start backend in production mode
NODE_ENV=production npm start
```

## API documentation

With the server running:

- Swagger UI: `http://localhost:5000/api/docs`
- OpenAPI JSON: `http://localhost:5000/api/openapi.json`
- Source: [server/openapi.yaml](server/openapi.yaml)

A route summary is in [docs/API.md](docs/API.md).

## Browser-assisted autofill

The local helper is documented in [docs/AUTOFILL.md](docs/AUTOFILL.md). It fills
supported forms in a visible browser, attaches the **approved** tailored PDF or
DOCX, fills the saved cover letter and approved answers, reports missing fields
and validation errors, and stops before the final submission control. You submit
the application yourself. Greenhouse, Lever, and Ashby have maintained adapters;
LinkedIn, Workday, and unknown hosts return manual-fallback instructions. No
CAPTCHA, OTP, MFA, login, or terms acceptance is bypassed, and the helper has no
`click()` call.

## AI configuration

AI is optional and off by default. Matching is always deterministic and works
without any AI provider.

To enable AI drafts with any OpenAI-compatible chat-completions API:

```env
AI_PROVIDER=openai
AI_API_KEY=your-server-side-key
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

Compatible gateways such as OpenLLM or other OpenAI-compatible routers can be
used by changing `AI_BASE_URL` and `AI_MODEL`; no code changes are needed. Cost,
data-retention, and model-quality terms are set by the provider you choose.
Review them before sending resume or profile content.

AI behavior:

- Server-side only; the key is never sent to the browser.
- JSON output is parsed and validated with zod.
- Timeouts, HTTP errors, rate limits, malformed JSON, and missing answers all
  fall back to template content with an explicit notice.
- Prompts forbid inventing employers, degrees, dates, metrics, or skills.
- Generated content is always a draft; the user must review and edit it.

## Security summary

- bcrypt password hashing, no password hashes in API responses.
- JWT bearer tokens with issuer, expiry, token version, and session revocation.
- Zod validation for bodies, params, and queries.
- Helmet security headers, strict CORS allowlist, rate limits.
- Resume files are stored as private MongoDB documents, excluded from normal
  queries, and served only to the owner through an authenticated download route.
- Structured JSON logs redact tokens, passwords, resume text, and secrets.
- No secrets in frontend code, logs, or version control.

See [docs/SECURITY.md](docs/SECURITY.md) for details and production hardening.

## Deployment

Free-tier configuration is included:

- `server/` → Render (`render.yaml`)
- `client/` → Vercel (`client/vercel.json`)
- MongoDB Atlas free cluster

Step-by-step instructions, limits, and troubleshooting:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Live deployment cannot be verified until you supply accounts and credentials.

## Limitations and required user actions

- **Deployment:** Create MongoDB Atlas, Render, and Vercel accounts, set the
  environment variables, and deploy. This session did not deploy.
- **AI key:** Optional. Without one, drafts are templates, not AI output.
- **Single resume:** One resume per account; uploading replaces the previous file.
- **Source dependency:** Live discovery needs outbound network access to each
  provider you enable. Their listings and availability are outside this
  project's control; a partial outage shows up as a per-source error, not as
  missing data. Greenhouse, Lever, and Ashby only return results for boards you
  name.
- **URL import limits:** Pages that need JavaScript rendering, a signed-in
  session, or a CAPTCHA cannot be read. Those cases return the manual-import
  fallback by design.
- **No email verification or password reset:** Not implemented. A lost password
  currently has no self-service recovery.
- **Browser token storage:** The JWT is stored in `localStorage`. This is
  practical for a single-page app but means a successful XSS could steal the
  token. The app escapes user content and ships no third-party scripts; for a
  higher-security deployment, move to short-lived tokens with refresh cookies.
- **No automated submission or LinkedIn automation:** Deliberate. Use the
  assisted workflow and submit manually.
- **No background jobs or email reminders:** Not implemented.
- **Free-tier cold starts:** Render free services sleep after inactivity; the
  first request can take about a minute.
- **No live AI provider test:** The AI fallback path is tested; a real provider
  call requires your API key.

## License

No license file is included. Add one before distributing the project.
