# Verification Report

Date: 2026-10-20 (local)
Environment: Windows, Node.js v22.16.0, npm 11.6.2
Test database: `mongodb-memory-server` pinned to MongoDB 7.0.14

This report reflects checks actually run in this workspace. It is not a claim of
live deployment.

## 1. Backend automated tests

Command:

```bash
cd server && npm test
```

Result: **87 tests passed, 0 failed** (`node:test` + supertest against an
in-memory MongoDB instance).

Coverage includes:

- Health, readiness, 404 shape, security headers, CORS allow/deny, OpenAPI JSON
- Registration validation, duplicate email, login failure/success
- Protected-route 401s, JWT revocation after logout
- Profile update, completeness, invalid URL rejection
- Profile extensions: projects with technologies and verified accomplishments,
  certifications, achievements, answer-bank approval timestamps, work
  authorization, extra job preferences, and rejection of invalid nested values
- PDF upload/parsing, DOCX replacement, unsupported file rejection
- Private resume text/download access, cache headers, deletion
- Resume extraction review: proposals, headline conflict detection, no writes
  during review, protection of verified values, explicit overwrite, duplicate
  reporting, `reviewed: true` requirement, and cross-user isolation
- Tailored resumes: generation from verified data only, omission of unverified
  accomplishments, PDF/DOCX storage, original resume unchanged, revision
  versioning, editing, approval locking, regeneration, owner-only downloads,
  application-preview gating, and AI-provider failure fallback
- Manual job validation, duplicate URL prevention, save state
- Search, filters, sorting, pagination
- Explainable match values and `resumeUsed`
- Cross-user authorization (job/application isolation)
- Application state transitions
- Direct `submitted` status blocked without explicit confirmation
- Preview workflow disclosure and verified prefill
- Approved submission recording
- AI fallback labeling when no provider is configured
- AI input validation
- Live-provider normalization, import deduplication, honest 503 on provider failure (mocked fetch)
- Dashboard aggregation and serialized activity ids
- Logout token revocation

Phase 1 additions (`tests/jobSources.test.js`, `tests/urlImport.test.js`, and
four endpoint tests in `tests/integration.test.js`):

- Each adapter (Remotive, Jobicy, Arbeitnow, Greenhouse, Lever, Ashby, Remote OK)
  against
  realistic provider payloads, including bad rows, escaped HTML, array fields,
  Unix-second dates, and missing board names
- Job-type normalization across provider variants
- Multi-source merge, cross-source deduplication, and round-robin interleaving
- Per-source error isolation (one 500 and one network failure with a healthy
  source), per-source timeout, and 503 only when every source fails
- Unknown source rejection and skipped/unconfigured board reporting
- Successful-response caching and cache clearing
- SSRF guard: scheme, credentials, port, hostname, IPv4/IPv6 private ranges,
  mixed DNS answers, unresolvable hosts
- Redirect-hop re-validation, size cap, content-type rejection, deadline
- schema.org JobPosting (`@graph`, TELECOMMUTE, salary formatting), metadata
  fallback, login-wall/CAPTCHA detection, unreadable page handling
- Pinned-DNS lookup for hostnames and the full URL-import endpoint (draft,
  manual fallback, save, duplicate save, blocked URLs)
- Board imports with a prefixed id (`acme:4451`) or a raw id plus `board`

Phase 3 additions (`tests/jobSources.test.js` plus one endpoint test in
`tests/integration.test.js`):

- Remote OK adapter against the public-feed shape: legal-notice row skipped,
  `apply_url` fallback to the listing URL when it is unusable, internship tag
  mapping, salary formatting, search filtering, unexpected-payload source error,
  re-fetch/import by id, honest 404 for an unknown id
- Location matching: `india` matched by country, metro, or state; generic
  location substring matches; empty query leaves results untouched
- Discovery filters combined with multi-source merge: location, remote flag,
  job type, echoed `filters`, and an honest empty result set where every source
  is still `ok`
- Discover endpoint validation: invalid `jobType` and `remote` values rejected
  with 400 before any provider is contacted

## 2. Frontend automated tests

Command:

```bash
cd client && npm test
```

Result: **9 tests passed, 0 failed** (Vitest + Testing Library, 1 file).

Coverage:

- Unauthenticated redirect to login
- Client-side login validation with no API call
- Login → authenticated dashboard rendering real mocked API data
- Session restore + jobs empty state
- Job detail → labeled template draft → preview dialog → record button disabled until explicit approval checkbox
- Discover tab: location/work-mode/job-type filters sent to the API, result
  summary line, and the Remote OK attribution rendered as a follow link
- Profile extensions: project with technologies and a verified accomplishment,
  certification, achievement, approved answer, work authorization, and work
  mode all reach the API in the expected shape
- Resume extraction review: conflict displayed, verified value protected by
  default, unverified accomplishments, and explicit opt-in to overwrite
- Tailored resume: generate, render differences, edit the summary/skills,
  require an approval checkbox, and lock editing after approval

## 3. Production build

Command:

```bash
npm run build
```

Result: **success**, Vite 8.3.4.

```text
dist/index.html                   0.62 kB │ gzip:   0.37 kB
dist/assets/index-Bf9JOlPt.css   44.05 kB │ gzip:   9.27 kB
dist/assets/index-DBBFhJKU.js   410.77 kB │ gzip: 114.03 kB
built in 312ms
```

## 4. Backend syntax check

```bash
cd server
for f in $(find src tests -name '*.js'); do node --check "$f" || exit 1; done
```

Result: all files passed.

## 5. Real HTTP end-to-end smoke test

A real Express process was started on `127.0.0.1:5055` against a temporary
MongoDB 7.0.14 instance. A script exercised the actual HTTP API (not supertest).

Passed with the following statuses:

| Step | Status |
| --- | --- |
| Health | 200, database connected |
| Readiness | 200 |
| Register | 201 |
| Profile update | 200 |
| PDF resume upload + parsing (skills detected) | 201 |
| Private resume download (`%PDF-` magic, `private, no-store`) | 200 |
| Create job | 201 |
| Job detail + match + reasons + `resumeUsed` | 200 |
| Cover letter fallback (`provider: template`, explicit notice) | 200 |
| Application preview (`automatedSubmission: false`) | 200 |
| Direct PATCH to `submitted` | 400 (blocked) |
| Explicit approved submission | 200 |
| Live Remotive discovery via API | 200, 5 jobs, source `remotive` |
| Import a live listing | 201 |
| Match imported live job | 200 |
| Live multi-source discovery (Remotive + Jobicy + Arbeitnow) | 200, 8 jobs, 3 sources `ok`, 0 errors |
| Live Greenhouse board discovery (`greenhouse=stripe`) | 200, 20 Stripe listings, interleaved with other sources |
| Live Greenhouse import (`stripe:8172510`) | 201, then 200 duplicate |
| `GET /jobs?source=greenhouse` | 200, 1 saved job |
| URL import of a real public Lever page | 200, `json-ld`, high confidence, company Spotify |
| URL import SSRF cases (`localhost`, metadata host, credentials, `file:`, `ftp:`) | 400 `URL_BLOCKED` |
| Dashboard aggregation | 200 |
| Logout | 200 |
| Reuse revoked token | 401 (rejected) |

**Live provider was verified against `https://remotive.com/api/remote-jobs` on
2026-10-19.** This does not guarantee future provider availability.

## 6. Browser verification

The Vite dev server was opened in the shared browser against the smoke API.

Verified visually and through accessibility snapshots:

- Responsive registration page; successful account creation
- Dashboard loaded real API data (stats, resume card, activity, recommendations)
- Empty job workspace
- Live Remotive listings rendered with source attribution
- Imported listing appeared as `Saved` with `Remotive` source
- Job detail showed score, components, matched/missing skills, and reasons
- Template cover letter generated, marked **Template**, with notice, in editable fields
- Application preview dialog showed verified full name/email, cover letter, workflow steps,
  limitations, and an **unchecked** approval checkbox
- The “I submitted this — record it” button was **disabled** until the checkbox was checked
- The browser test did **not** check the box or record a false submission
- Browser console showed no React key warnings after the activity-id fix

Phase 1 additions, verified in the same live browser session:

- Discover tab renders the source picker with Remotive, Jobicy, and Arbeitnow
  checked and the three company-board sources unchecked by default
- A live search returned 12 cards alternating `Remotive`, `Jobicy`, and
  `Arbeitnow`, with per-job source labels and attribution naming all three
- Source-status notices appear when a chosen source has no boards configured
- Pasting a real Lever job URL produced a draft with platform label,
  `json-ld` extraction, high confidence, "URL reading only, no platform API",
  the correct title/company/location, and the extraction note
- "Save job" persisted the draft (success notice) and the saved workspace then
  showed the role with the `Imported URL` source label and `Saved` status
- No console errors were produced by either flow

## 7. API documentation

- `GET /api/docs/` returned 200 and served Swagger UI assets
- `GET /api/openapi.json` returned 200
- OpenAPI document parsed successfully during app startup

## 8. Secret handling

```bash
git check-ignore -v server/.env client/.env
```

Both `.env` files are ignored. `git ls-files` contains **no** `.env` files.
No real secrets were printed or committed. The test/dev JWT secret is local only.

## 9. Dependency audit

- Client: `npm audit` → **0 vulnerabilities**
- Server: `npm audit` → **3 moderate** advisories from
  `mammoth → argparse@1.0.10 → sprintf-js@1.0.3`.
  - The latest `mammoth` (1.13.0) still pins the vulnerable `argparse`.
  - The vulnerable package is used by mammoth's CLI path, not by the
    `extractRawText` library API used here.
  - `npm audit fix --force` proposes downgrading mammoth to 0.3.29, a breaking
    change, so it was intentionally not applied.
  - No high-severity advisories remain; `nodemon` was replaced with
    `node --watch` and removed.

## 10. Bugs found and fixed during verification

1. **Environment parsing failed on empty/zero values.** Empty `.env` values and
   an exported `PORT=0` aborted startup. Empty values now fall back to defaults;
   `PORT=0` is treated as unset; production still requires `MONGO_URI` and a
   strong `JWT_SECRET`.
2. **Activity records serialized without `id`.** This caused duplicate React keys
   in the dashboard timeline. Added the model `toJSON` transform and a test.
3. **Profile completeness always reported `name` missing.** The check was
   hardcoded false. Fixed and asserted in tests.
4. **AI-resume prerequisite errors were only shown at the page top.** Inline
   errors and disabled AI actions were added when no resume exists.
5. **Corrupt test MongoDB download.** Pinned `MONGOMS_VERSION=7.0.14` and
   removed the corrupted cached download so test runs are reproducible.
6. **Pinned DNS lookup used the wrong callback contract.** Node asks for the
   full address list (`options.all`) when connecting to a hostname; returning a
   single address made every URL import fail with
   `ERR_INVALID_IP_ADDRESS`. Fixed and covered by a hostname-based test; the
   original tests used IP literals, where `lookup` is never called.
7. **One prolific source filled the whole first page.** Merged discovery now
   round-robins across healthy sources, so a Jobicy result is visible alongside
   Remotive results. Covered by an interleaving test.
8. **A project sentence was parsed as a project name.** The first extraction
   heuristic accepted any capitalized line up to 90 characters, so a description
   sentence became a separate project. Names now must also be short (at most
   eight words) with no terminal punctuation, and the DOCX fixture asserts the
   project description stays attached.

## 11. Not verified / requires user action

- **Live deployment:** no Render, Vercel, Atlas, or AI provider account access.
- **Real AI provider call:** no API key was supplied. Only fallback behavior and
  provider failure handling were tested.
- **MongoDB Atlas production cluster:** not provisioned or connected.
- **Email verification / password reset:** not implemented.
- **Browser automation / CAPTCHA / LinkedIn, Naukri, Internshala, Wellfound,
  Indeed, Foundit, Cutshort, Unstop:** intentionally not implemented — none
  offers a permitted public job API (see `docs/API.md`); URL import and manual
  entry are the supported paths.
- **LinkedIn / Internshala / Wellfound extraction:** not tested against those
  live sites. They have no public job API here; their pages are read as normal
  HTML, and signed-out or bot-checked pages fall back to manual entry. No login
  or CAPTCHA bypass exists to test.
- **JavaScript-rendered job pages:** cannot be read by a plain HTML fetch; those
  return the manual-import fallback.
- **PDF/DOCX from real-world diverse resumes:** tested with generated fixtures;
  complex scanned documents are rejected by design.
- **Load, penetration, and accessibility audits:** not performed.
- **Resume extraction quality:** the parser is deterministic and heuristic
  (headings, bullets, known skill aliases, URL/email/phone patterns). It is not
  an LLM and does not understand arbitrary layouts; section-less resumes yield
  few or no project/certification proposals. Every value is reviewed by the user
  before it can reach the profile.
- **Answer-bank approval:** approval is a manual user action with no employer
  or fact verification. Answers are never auto-inserted into third-party forms.
- **Work authorization:** self-reported by the user; the app does not verify
  immigration status or employer sponsorship policies.
- **Resume generation (PDF/DOCX):** not implemented; this is Phase 5 work.

## 12. Phase 3 live discovery probe (2026-10-20)

Run directly against the real providers (no mocks, no database involved):

| Probe | Result |
| --- | --- |
| `remotive,jobicy,arbeitnow,remoteok` merged | 4/4 sources `ok`; 12 interleaved jobs; the Remote OK feed returned ~100 listings |
| Same sources with `location=india` | 0 matches in that recent batch — honest empty set, every source still `ok` |
| Same sources with `remote=true, jobType=internship` | 0 matches — honest empty set |
| `greenhouse=groww,lever=cred` (live Indian-company boards) | 8 listings, e.g. Greenhouse `Bengaluru-VTP, India` and Lever `mumbai` / `bengaluru` |
| Same boards with `location=india` | 8 India-matching listings, including city-only Lever locations matched through the India alias list |
| Same boards with `location=india, jobType=internship` | 0 matches — those boards currently list no internships; nothing was fabricated |

The four remote-oriented feeds index mostly non-India roles; India-local
listings come from Indian-company Greenhouse/Lever/Ashby boards configured via
`GREENHOUSE_BOARDS` / `LEVER_SITES` / `ASHBY_ORGS` or per request. An empty
filtered result is reported honestly, never padded.

## 13. Phase 4 master profile and extraction review (2026-10-21)

All results below come from the automated suites and are reproduced by the
commands in sections 1–4.

| Check | Result |
| --- | --- |
| `cd server && npm test` | **82/82 passed**, exit 0 (5 new integration tests) |
| `cd client && npx vitest run` | **8/8 passed**, exit 0 (2 new UI tests) |
| `npm run build` | exit 0; CSS 44.05 kB (9.27 gz), JS 395.53 kB (111.39 gz) |
| Profile extensions persist | Projects with technologies and per-accomplishment `verified` flags, certifications, achievements, answer bank, work authorization, and `workModes`/`willRelocate`/`noticePeriod` all round-trip |
| Answer approval | Approved entry receives `approvedAt`; unapproved draft does not; preview returns only the approved answer |
| Invalid nested values | `javascript:` project URL, empty answer, and unknown work-authorization status all return 400 `VALIDATION_ERROR` |
| Extraction review | DOCX fixture yields headline `Senior Backend Developer`, email, phone, LinkedIn, an `Internship Tracker` project with Express/MongoDB technologies and 2 accomplishments, 2 certifications, 2 achievements; headline is reported as a conflict against the saved profile. Every proposal is editable in the review UI before applying. |
| Review writes nothing | After the review call, the stored headline and project list are unchanged |
| Apply without permission | Headline skipped with `existing_value_protected`; skills merged; project inserted; extracted accomplishments saved as `verified: false`; duplicates reported |
| Apply with permission | `overwriteVerified: true` replaces the headline; duplicate entries are still reported instead of silently duplicated |
| Apply validation | `reviewed: false` returns 400 |
| Ownership | A second account receives 404 for `/resumes/me/extraction`; resume review uses only the authenticated owner's document |

The review endpoint recomputes proposals from the stored resume text, so a
stale `parsed` snapshot cannot be applied behind the user's back.

## 14. Phase 5 tailored resumes (2026-10-21)

| Check | Result |
| --- | --- |
| `cd server && npm test` | **87/87 passed**, exit 0 (4 integration tests + 1 AI-failure test added) |
| `cd client && npx vitest run` | **9/9 passed**, exit 0 |
| `npm run build` | exit 0; CSS 44.05 kB (9.27 gz), JS 410.77 kB (114.03 gz) |
| Verified-only generation | Document skills exactly equal the stored profile skills (`diff.skills.added` is empty); only `verified: true` accomplishments are included; 2+ unverified claims appear under `changes.omitted` |
| Both formats | One 201 response stores a PDF (`%PDF-` signature) and a DOCX (`PK` signature) with sizes and SHA-256 checksums; file buffers never appear in JSON |
| Original-file comparison | `diff.sourceResume.id` matches `baseResumeId`; skills found only in the uploaded document (e.g. `AWS`) are listed as omitted, while profile skills such as `TypeScript` are not |
| Original resume untouched | The original resume id, checksum, and `uploadedAt` are identical before and after generation |
| Ownership | A second account gets 404 for detail, download, and generation against the first account's job |
| Editing | PATCH updates content and rebuilds both files; approved revisions return 409 |
| Approval | `approved: false` returns 400; `approved: true` sets `approvedAt`; preview exposes only the approved revision while reporting the newer draft |
| Versioning | Regeneration creates revision 2 as a draft, keeps revision 1 approved, and marks only revision 2 as the latest |
| Downloads | PDF has `application/pdf`, `%PDF-`, `private, no-store`, and attachment disposition; DOCX starts with `PK`; invalid format returns 400 |
| AI failure | With a configured provider whose request throws, generation still succeeds using the deterministic summary with provider `heuristic` and a `Provider issue` notice |
| Frontend | Generate → diff rendered → edit summary/skills → save (PATCH shape asserted) → approval checkbox required → approved state locks editing |

The PDF/DOCX generators are now production dependencies (`pdfkit`, `docx`),
listed under `dependencies` in `server/package.json` and the lockfile.

## 15. Phase 6 readiness and browser-assisted autofill (2026-10-22)

| Check | Result |
| --- | --- |
| `cd server && npm test` | **104/104 passed**, exit 0 (8 new API integration tests, 6 unit tests, 3 live browser tests) |
| `cd client && npx vitest run --pool=threads` | **10/10 passed**, exit 0 (1 new readiness UI test) |
| `cd client && npm run build` | exit 0; `dist/assets/index-Bej5Wfsy.css` 47.00 kB (9.74 gz), `index-DpnYYUhw.js` 420.48 kB (116.31 gz) |
| Readiness without approval | A freshly tracked job reports `ready: false`, blocking `approved_resume`, `applicationStatus: "saved"`, `statusPreserved: true`, adapter `greenhouse` supported |
| Readiness with approval | After generating and approving revision 1, `ready: true`, `blocking: []`, approved PDF+DOCX listed with download paths, status still `saved` |
| Cover letter requirement | `coverLetter: "required"` fails with no saved letter; after `PATCH` saves one, the same check passes |
| Approved answers only | A saved but unapproved answer is not matched; the missing question is returned in `missingAnswers` and blocks readiness when questions are required |
| Plan source discipline | First name/email/phone/school/graduation year come from the account/profile; summary and skills come from the approved revision (`source: approved_tailored_resume`); unverified accomplishments are absent from `projects` |
| Plan safety | `safety.autoSubmit: false`, `finalSubmissionRequiresHuman: true`, `hiddenSubmissionAllowed: false`, forbidden actions include CAPTCHA bypass |
| Unsupported portal | LinkedIn URL returns `supported: false`, `fields: []`, blocker `unsupported_portal`, manual-fallback instructions |
| Run report audit | `POST /applications/:id/autofill-runs` stores `submitted: false` and leaves the application `saved` with no `submittedAt`; `submitted: true` is rejected with 400 `VALIDATION_ERROR`; unknown adapter returns 400 |
| Ownership | A second account receives 404 for readiness, plan, and run list; posting a run against the first account's application also returns 404 |
| Adapter registry | `/autofill/adapters` lists greenhouse, lever, ashby, linkedin, workday, generic with correct support flags; `/adapters/detect` matches lever, falls back to generic, and rejects a malformed URL with 400 |
| Live Playwright fill | Local Greenhouse-shaped form: 6 fields filled, PDF attached (`files.length === 1`), cover letter filled, approved question answered, 0 missing fields, 0 validation errors, `__submitted === 0`, `__clickedSubmit === false`, submit control still enabled |
| Live login refusal | A page with a password field returns `status: "failed"`, `blockedBy: ["login"]`, 0 fields filled, password empty, no submit |
| CLI end-to-end | `node tools/autofill/cli.js --plan … --resume-pdf … --headless --no-wait --report …` on a loopback fixture exited 0: status `prepared`, 2 fields filled, PDF attached, 1 approved answer filled, 0 missing, 0 validation errors, 1 final control reported and untouched, `submitted: false` |
| Unsafe plan | `autoSubmit: true`, `finalSubmissionRequiresHuman: false`, or `canAutofill: false` is rejected before launch (`SAFETY_POLICY_MISSING` / `PLAN_BLOCKED`) |

The default Vitest `forks` pool failed to start a worker once in this
environment (timeout, no tests executed). Reruns used `--pool=threads` and all
10 tests passed; no test was changed or skipped. The root `npm test` script still
invokes the project's existing commands.

### Portals: tested vs. supported vs. untested

| Portal | Adapter support | Live employer form tested |
| --- | --- | --- |
| Greenhouse | Autofill + resume upload | No — local Greenhouse-shaped fixture only |
| Lever | Autofill + resume upload | No |
| Ashby | Autofill + resume upload | No |
| LinkedIn | Unsupported (login + terms) | Not attempted |
| Workday | Unsupported (account-gated) | Not attempted |
| Unknown host | Manual fallback only | Not attempted |

Playwright lives only in `tools/autofill/package.json` and is not a server or
client dependency. Without it, the live browser tests skip with an install
message; the unit and API suites still run.

### Files added or changed in Phase 6

Added: `server/src/services/autofill/{adapters,safety,plan}.js`,
`server/src/services/readiness.js`,
`server/src/models/AutofillRun.js`,
`server/src/controllers/autofillController.js`,
`server/src/routes/autofillRoutes.js`,
`server/tests/autofillUnits.test.js`,
`server/tests/autofillIntegration.test.js`,
`server/tests/autofillBrowser.test.js`,
`client/src/components/Readiness.jsx`,
`tools/autofill/{package.json,cli.js,lib/{guard,plan,detect,fill,session}.js}`,
`docs/AUTOFILL.md`.

Changed: `server/src/routes/applicationRoutes.js`, `server/src/validators/schemas.js`,
`server/src/app.js`, `client/src/api/client.js`, `client/src/pages/JobDetailPage.jsx`,
`client/src/components/Icon.jsx`, `client/src/styles.css`,
`client/src/__tests__/app.test.jsx`, `.gitignore`, `package.json`, `README.md`,
`docs/{API,SECURITY,VERIFICATION}.md`.

## 16. Release-readiness audit (2026-10-23)

Full re-verification of the shipped Phase 6 state. Commands and exit codes are
exact; results are grouped so local fixtures and real employer pages are never
mixed.

### Automated suites (all re-run after the final code state)

| Check | Command | Result |
| --- | --- | --- |
| Backend | `cd server && npm test` | **105/105 passed**, 0 failed, 0 skipped, exit 0 |
| Frontend | `cd client && npx vitest run --reporter=dot` | **10/10 passed**, exit 0 |
| Production build | `cd client && npm run build` | exit 0; `dist/assets/index-Bej5Wfsy.css` 47.00 kB (9.74 gz), `index-DpnYYUhw.js` 420.48 kB (116.31 gz) |
| Autofill unit | included in backend suite | 9/9 (plan safety, selector building, answer matching, report shaping) |
| Autofill browser fixtures | included in backend suite | 4/4 (Greenhouse fixture fill, login refusal, unsafe-plan rejection, delayed-form + hidden-template regression) |
| Dependency audit | `npm audit --omit=dev` and `npm audit` in server, client, tools/autofill | **0 vulnerabilities** in all six runs |

### Fixes made during the audit (each with a regression test)

1. **Visible-only validation errors** — Lever ships permanent hidden
   `"file exceeds max size"` template paragraphs; only visible nodes now count
   as validation errors, so a clean fill is no longer reported as dirty.
2. **Hidden inputs excluded from `unsupportedControls`** — hidden radio or
   checkbox groups no longer pollute the report.
3. **Bounded wait for dynamically mounted React forms** — the helper now waits
   for one of the adapter's own selectors before scanning; if the form never
   appears it reports `form_not_found` for each planned field and types
   nothing. Regression test drives a form that mounts ~2 s after load.

### Environment validation (9/9)

`NODE_ENV=production` startup is refused, with the exact message, when any of
these hold: missing `MONGO_URI`, missing `JWT_SECRET`, `JWT_SECRET` shorter
than 32 characters, `URL_IMPORT_ALLOW_HTTP=true`, or
`URL_IMPORT_ALLOW_PRIVATE_HOSTS=true` (SSRF guard), `AI_PROVIDER=openai`
without `AI_API_KEY`, or a non-HTTP(S) `CLIENT_URL` origin. A valid
production configuration starts cleanly with `CORS_ORIGINS` split from the
comma-separated `CLIENT_URL`, and development needs no secrets (documented
insecure dev default, warned at startup).

### Production startup and health checks (live run, final code)

`NODE_ENV=production` with the real configured MongoDB (Atlas) on a test port:

| Check | Result |
| --- | --- |
| Startup | `mongodb_connected`, then `server_started` with `environment: production` in structured JSON logs |
| `GET /api/health` | 200, `database: "connected"`, `environment: "production"` |
| `GET /api/health/ready` | 200, `status: "ready"` |
| CORS, disallowed origin | 403, logged as `request_rejected` |
| CORS, allowed origin | 200 with `Access-Control-Allow-Origin` |
| Unauthenticated `/api/applications` | 401 with request id, no stack trace |
| Rate limiting | `RateLimit-Policy: "600-in-15min"` header present |
| Helmet headers | `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN` |
| Graceful shutdown | Code path (`server.close` + `disconnectDB` + forced-exit timer) reviewed; live signal test not possible on this Windows host — `taskkill` cannot deliver SIGTERM/SIGINT and Git Bash `kill -INT` does not reach native Node processes. The path runs on Linux (Render); reported as reviewed-but-not-live-tested. |

### Real employer pages (dummy data only, nothing submitted)

Both runs used the final code, the CLI in `--headless --no-wait` mode with a
disposable browser profile, a clearly labeled dummy identity and a generated
dummy PDF. No application, account, or personal data was used; no submission
control was clicked; `submitted: false` in every report.

| Portal | Page | Result |
| --- | --- | --- |
| Ashby | `jobs.ashbyhq.com/simpleclosure/3d29b324-...` `/application` | React form found via the bounded wait. Filled `fullName` (`_systemfield_name`), `email` (`_systemfield_email`), `linkedinUrl` (via the "LinkedIn Profile" label). Resume PDF attached to `_systemfield_resume` — **not** the separate "Autofill from resume" helper input. 7 fields this form does not expose reported `field_not_found`. 1 submission control ("Submit Application") untouched. No bot protection present. |
| Lever | `jobs.lever.co/palantir/d5486403-...` `/apply` | 6 fields filled via exact Lever selectors: `name`, `email`, `phone`, `location`, `urls[LinkedIn]`, `urls[GitHub]`. Resume PDF attached. School/degree/graduation year/cover letter not on the form — reported `field_not_found`. Invisible reCAPTCHA **and** hCaptcha scripts detected and recorded in `botProtection.kinds` without blocking or touching them (`visibleChallenge: false`). 2 submission controls ("SUBMIT APPLICATION" + an unlabeled button) untouched. 0 validation errors. |
| Lever | a `/apply` URL for an expired posting (Solopulse) | HTTP 404 page; helper reported `form_not_found` for every field, typed nothing, submitted nothing — correct safe behavior. |
| Greenhouse | `job-boards.greenhouse.io/cloudflare/jobs/7695702` | Client-rendered form found via the bounded wait. Filled `firstName`/`lastName`/`email`/`phone` (`#first_name`, `#last_name`, `#email`, `#phone`), `linkedinUrl` (via the "LinkedIn Profile" label fallback), `location` (`#candidate-location`). Resume PDF attached. GitHub/company/school/degree/cover letter not exposed by this form — reported `field_not_found`. 6 custom dropdowns (Country, Location, sponsorship question, EEO questions) reported as unsupported controls instead of being touched. Invisible reCAPTCHA detected (`visibleChallenge: false`), not blocked and not interacted with. 2 submission controls ("Apply", "Submit application") left untouched. 0 validation errors. |

All three supported portals now have at least one live-verified form. Live
forms prove the adapter approach on real pages; they do not prove every
posting on any portal (forms are per-company and per-role).

### Deployment configuration

`render.yaml` reviewed: `rootDir: server`, `npm ci` + `npm start`,
`healthCheckPath: /api/health`, `JWT_SECRET generateValue: true`, all secrets
`sync: false` (dashboard-supplied, none in the repository). No deployment was
performed.

## 17. India-first discovery round (2026-10-25)

### Per-platform access probes (real requests, no mocks)

| Platform | Probe | Result |
| --- | --- | --- |
| LinkedIn | `GET /jobs/search/?keywords=backend%20intern&location=India&f_JT=I&f_WT=2` signed out | HTTP 200, no login redirect — the guest search URL works with LinkedIn's own `f_JT`/`f_WT` filters |
| Internshala | `GET /internships/keywords-…` variants | Redirect to the generic `/internships/` — the keyword search is a **form POST**, so no honest keyword GET URL existsCity and remote listing links (`internship-in-<city>`, `work-from-home-internships`) were confirmed from real hrefs served on `/internships/` |
| Naukri | `GET /backend-intern-internship-jobs` and `/backend-intern-jobs` | HTTP 200, no redirect |
| Wellfound / Unstop / Cutshort | `?query=` / `?search=` search URLs | HTTP 200 |
| Foundit | `GET /srp/results?query=…/jobtype/internship` | HTTP 200; the `/search/<slug>` variant answers **403** — only the `srp/results` shape is used |
| Adzuna | `GET api.adzuna.com/v1/api/jobs/in/search/1` with dummy credentials | HTTP 401 `AUTH_FAIL` — the documented official-API contract is live; a valid free key makes it a genuine India listing source |

None of these platforms exposes a permitted public listing API for third
parties, so none is claimed as a live integrated source. Discovery responses
now carry verified `shortcuts` (see [docs/API.md](API.md)) built from applied
filters, clearly labeled `search-shortcut` / `automaticIntegration: false`; the
Internshala shortcut deliberately opens listing pages rather than faking a
query URL the site does not support.

### Adzuna (official API) integrated live

- Adapter `server/src/services/jobSources/adzuna.js`: fixed base URL, `country=in`
  default, `max_days_old=30`, defensive field mapping (salary, location, contract
  type), unusable rows dropped, missing credentials → `not_configured`.
- Unconfigured Adzuna is **skipped, not failed**: with `sources=remotive,adzuna`
  and no keys, a regression test asserts Remotive still returns results and the
  response reports `adzuna.status=skipped, error.code=not_configured`.
- `JOB_SOURCES` / `IMPORTABLE_SOURCES` / OpenAPI enums / client labels updated;
  import-by-id works through the same shared path.

### Regression tests added and result

`server/tests/jobSources.test.js` extended: registry shape with `adzuna`,
Adzuna response mapping + unusable-row drop, missing-credential code,
unconfigured-skip isolation, shortcut URL shapes for all seven platforms,
Internshala fallback behavior, and "shortcuts live beside live results, never
merged into them". Result: **112/112 backend tests pass; 10/10 frontend tests
pass; production build succeeds** (2026-10-25).

### Finalize round (2026-10-25, same day)

- **Adzuna hardening:** multi-page pagination (up to 5 pages / 100 rows, used
  when import-by-id asks for more than one free-tier page; regression test
  walks pages 1→2 and asserts no duplicate ids), country-code validation
  (`^[a-z]{2}$` both in the adapter and the env schema — "INDIA"/"!!"
  yield `not_configured`, not a fake outage), salary/location/contract mapping
  unchanged.
- **India-first defaults:** the web client's discovery location defaults to
  "India"; with no explicit `location`, discovery applies a stable India-first
  ranking after dedupe/interleaving (new regression test proves the Indian
  listing surfaces first and the foreign one is still present — nothing
  dropped). Explicit-location ordering is untouched; the round-robin interleave
  test still passes unchanged.
- **Shortcut re-probe (live, no mocks):** all ten probed URLs returned
  HTTP 200 — LinkedIn guest search with `f_JT=I&f_WT=2`, Internshala remote and
  city listing pages, Naukri internship + job slugs, Wellfound, Unstop,
  Cutshort, Foundit `srp/results` — and the Adzuna API returned its documented
  `401 AUTH_FAIL` for dummy credentials.
- **Live end-to-end workflow (`demo-e2e-check.mjs` against the real backend on
  :5000 with the real MongoDB and providers):** 28/28 steps passed — auth,
  profile (88% completeness), resume upload, **live discovery** (remotive=ok,
  5 jobs), job create/dedupe (409 on the duplicate), tailored resume
  generate→approve→PDF download, readiness (`ready=true`), autofill plan on a
  real Greenhouse URL, recorded autofill run, **rejection of
  `submitted=true` claims and submit-without-confirmation**, cross-account
  404 isolation, and manual submit with `confirmation: true` only.
- **Authenticated live shortcut payload:** `GET /api/jobs/discover` with a real
  session returned 200, 3 live remotive jobs, and all 7 shortcuts
  (`linkedin,internshala,naukri,wellfound,unstop,cutshort,foundit`), first
  shortcut `kind=search-shortcut`, `automaticIntegration=false`, default
  locationIndia. Unauthenticated discovery correctly answers 401.
- **Result: 115/115 backend tests, 10/10 frontend tests, production build
  green; demo server started and stopped cleanly by PID.**

## 18. SmartRecruiters and Workable live round (2026-10-28)

Two new permitted public discovery sources were added because the majors
(LinkedIn, Internshala, Naukri, Wellfound, Unstop, Cutshort, Foundit) have no
permitted public job API. Both read an employer's own published feed —
`api.smartrecruiters.com/v0/companies/{board}/jobs` and
`approvals.api.workable.com`-style public account job widgets — no scraping
behind login, no hidden endpoints, no credential needed as long as the company
board id is known.

### Live verification (no mocks, real network, 2026-10-28)

| Adapter | Target | Listings | India-location | Fresh (≤90d) | Sample (title / location / posted / url / jobType) |
| --- | --- | --- | --- | --- | --- |
| smartrecruiters | `linkedin3` | 20 | 20/20 | 20/20 | Principal Program Manager · Bengaluru, KA, IN · 2026-10-28 · `https://jobs.smartrecruiters.com/LinkedIn3/744000158204220-principal-program-manager-vendor-sales-growth-excellence` · full-time |
| smartrecruiters | `WNSGlobalServices144` | 20 | 20/20 | 20/20 | Assistant Manager - Transactional Quality - Pune · Pune, MH, IN · 2026-10-28 · `https://jobs.smartrecruiters.com/WNSGlobalServices144/744000158332589-assistant-manager-transactional-quality-pune-magarpatta-sez-ref113749l-2026289324` · full-time |
| smartrecruiters | `WesternDigital` | 2 | 2/2 | 2/2 | India Site [ Strategy & Operations Program Manager ] · Bengaluru, KA, IN · 2026-10-23 · `https://jobs.smartrecruiters.com/WesternDigital/744000157507719-india-site-strategy-operations-program-manager-mba-8-years-experience` · full-time |
| workable | `exponent-energy` | 20 | 20/20 | 14/20 | APQP Program Quality Engineer (Battery) · Bengaluru, Karnataka, IN · 2026-10-06 · `https://apply.workable.com/j/2A8AC1C0F1` · full-time |
| workable | `mercari-india` | 11 | 11/11 | 6/11 | Engineering Manager - Backend · Bengaluru, IN · 2025-07-28 (board's own posted date, shown honestly) · `https://apply.workable.com/j/7E1007642A` · full-time |
| workable | `rapyuta-robotics` | 20 | 4/20 (Indian-board listings; overseas rows dropped by the location filter) | 10/20 | mixed Tokyo/Bengaluru board |

Notes:
- Every live row carries the employer's own canonical URL, a real postedAt date
  from the platform, and `source: smartrecruiters|workable`. Rows whose postedAt
  is stale (e.g. mercari's 2025-07-28) are presented with that date, not
  falsened; `lastCheckedAt` on every record shows when the cache was written.
- Detail enrichment for SmartRecruiters keeps the board-published summary when
  a detail request fails (never drops a row); worker-pool deadline leaves no
  holes in results.
- Defaults wired: `DEFAULT_TARGETS` in both adapters; client
  `DEFAULT_DISCOVERY_SOURCES = smartrecruiters, workable, remotive, jobicy,
  arbeitnow`; both registered as `requiresTarget` (per-board) sources, with
  clear `not_configured` skip notes when no board id is set.

### Tests and builds after this round

- Backend: `node --test` → **123/123 pass, exit 0**.
- Frontend: `vitest run` → **10/10 pass**, `vite build` → success, exit 0.
- Git: nothing staged, committed, pushed, or deployed. `.env` remains ignored.
