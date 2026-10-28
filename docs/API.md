# API Reference

Interactive documentation: **`/api/docs`** (Swagger UI)
OpenAPI JSON: **`/api/openapi.json`**
Source: [`server/openapi.yaml`](../server/openapi.yaml)

Base URL locally: `http://localhost:5000/api`

## Conventions

Success:

```json
{
  "success": true,
  "data": {},
  "meta": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 }
}
```

Error:

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Validation failed",
  "errors": [{ "field": "email", "message": "Enter a valid email address" }],
  "requestId": "..."
}
```

Protected routes require:

```http
Authorization: Bearer <jwt>
```

Uploads use `multipart/form-data` with the field name `resume`.

## Endpoints

### Health and docs

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health` | No | Liveness, database state, uptime |
| GET | `/health/ready` | No | 200 only when MongoDB is connected |
| GET | `/openapi.json` | No | OpenAPI document |
| GET | `/docs` | No | Swagger UI |

### Authentication

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/auth/register` | No | Create account, returns user + JWT |
| POST | `/auth/login` | No | Sign in, returns user + JWT |
| GET | `/auth/me` | Yes | Current user |
| POST | `/auth/logout` | Yes | Increment token version, revoke sessions |
| POST | `/auth/change-password` | Yes | Change password, revoke sessions, return new JWT |

Password requirements: 8–128 characters, at least one letter and one number.

### Profile

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/users/me` | Yes | Profile with completeness |
| PATCH | `/users/me` | Yes | Partial name/profile update |

Profile fields include `skills`, `education`, `experience`, `projects`
(`name`, `description`, `technologies`, `url`, `accomplishments` with an
`accomplishment.verified` flag), `certifications`, `achievements`, `answerBank`,
`workAuthorization`, `preferredRoles`, `preferredLocations`, and
`jobPreferences` (`jobTypes`, `remoteOnly`, `workModes`, `willRelocate`,
`availability`, `noticePeriod`, `minimumStipend`).

Saved answers carry an explicit `approved` flag. The API stamps `approvedAt`
when an answer becomes approved and never exposes unapproved answers in the
application preview.

### Resume

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/resumes` | Yes | Upload/replace PDF or DOCX (multipart `resume`) |
| GET | `/resumes/me` | Yes | Metadata, parsed skills, extracted text |
| GET | `/resumes/me/file` | Yes | Private attachment download |
| GET | `/resumes/me/extraction` | Yes | Compare heuristic extraction with the profile; writes nothing |
| POST | `/resumes/me/extraction/apply` | Yes | Apply reviewed extraction data with conflict protection |
| DELETE | `/resumes/me` | Yes | Delete stored resume |

The review response contains `proposals` (contact details, headline, skills,
projects with technologies and accomplishments, certifications, achievements),
a per-field `comparison` with `status` (`new`, `same`, `conflict`,
`unavailable`), and a `conflicts` list.

Applying requires `reviewed: true`. Existing non-empty scalar profile values are
skipped and returned in `skipped` with `reason: "existing_value_protected"`
unless `overwriteVerified: true` is sent. Skills and list entries merge
additively; duplicates are reported, and nothing is deleted. Extracted
accomplishments are saved with `verified: false` until the user ticks them on
the profile.

### Tailored resumes

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/tailored-resumes` | Yes | List revisions, optionally filtered by `jobId` |
| POST | `/tailored-resumes` | Yes | Generate a job-specific revision from verified profile data (`jobId`) |
| GET | `/tailored-resumes/:id` | Yes | Content, changes, diff against the original, and file metadata |
| PATCH | `/tailored-resumes/:id` | Yes | Edit a draft revision (`content`); rebuilds both files |
| POST | `/tailored-resumes/:id/approve` | Yes | Explicit approval (`approved: true`) for application use |
| POST | `/tailored-resumes/:id/regenerate` | Yes | Create a new draft revision, preserving earlier ones |
| GET | `/tailored-resumes/:id/download/:format` | Yes | Private PDF or DOCX download |

Generation uses only the stored profile: skills are reordered rather than
invented, and projects include only accomplishments with `verified: true`.
`diff.sourceResume` compares the uploaded file's parsed skills with the tailored
content and lists skills that exist only in the original document as omitted.
Unverified accomplishments are reported under `changes.omitted` and
`diff.projects[].omitted`. Each generation increments `revision` for that job and
stores separate PDF and DOCX buffers, linked to the job and the original resume.
The original resume is never written by these endpoints.

Drafts are editable; approved revisions return 409 on edit and remain available
for download. The application preview exposes `tailoredResume` only when an
approved revision exists, with `tailoredResumeWorkflow` explaining any draft that
still needs approval.

### Jobs

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/jobs` | Yes | List/search/filter/sort/paginate saved jobs |
| POST | `/jobs` | Yes | Add a job manually and create a saved tracking record |
| GET | `/jobs/:id` | Yes | Job, tracking record, match, `resumeUsed` |
| PATCH | `/jobs/:id` | Yes | Update job fields |
| DELETE | `/jobs/:id` | Yes | Delete job and tracking record |
| POST | `/jobs/:id/save` | Yes | Save/bookmark (idempotent) |
| DELETE | `/jobs/:id/save` | Yes | Remove only if still `saved` |
| POST | `/jobs/:id/match` | Yes | Recalculate explainable match |
| GET | `/jobs/discover` | Yes | Live listings from one or more sources (`search`, `location`, `remote`, `jobType`, `limit`, `sources`, `greenhouse`, `lever`, `ashby`) |
| POST | `/jobs/import` | Yes | Import a discovered listing by `externalId`, `source`, optional `board` |
| POST | `/jobs/import-url` | Yes | Read a public job page and return a reviewable draft (`url`, `save`) |

Job list query parameters: `q`, `location`, `jobType`, `remote` (`true`/`false`),
`source`, `status`, `sort` (`newest`, `oldest`, `title`, `company`, `postedAt`),
`page`, `limit` (max 50).

### Job discovery sources

| Source | Needs a company identifier | Notes |
| --- | --- | --- |
| `remotive` | No | Historical default; response shape unchanged |
| `jobicy` | No | Public remote-job API |
| `arbeitnow` | No | Public European job board API |
| `greenhouse` | Yes (`greenhouse` query param or `GREENHOUSE_BOARDS`) | Public board API |
| `lever` | Yes (`lever` query param or `LEVER_SITES`) | Public postings API |
| `ashby` | Yes (`ashby` query param or `ASHBY_ORGS`) | Public board API |
| `remoteok` | No | Public remote-job feed; attribution with a link back is shown with the results |
| `adzuna` | No (needs free API keys) | **Official Adzuna API**, India index by default (`ADZUNA_COUNTRY=in`, 2-letter code validated). Skipped with `not_configured` until `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` are set in server/.env. Listings carry `salary` when the source reports it, are capped to postings from the last 30 days, and requests paginate (up to 5 pages / 100 rows) when more than one free-tier page is needed. |

Discovery merges every healthy source, deduplicates by canonical URL and by
company+title, and returns `sources` (per-source status/count), `errors`
(failed sources only), and `availableSources`. One failing source still returns
200 with the other results; only when every requested source fails does the API
return 503.

Discovery also accepts `location` (matched against each listing's reported
location; `india` also matches major Indian cities and states), `remote`
(`true`/`false`), and `jobType`. The applied filters are echoed under
`filters`. An empty result set with every source `ok` means nothing matched —
not a provider failure. When the client sends **no** `location`, India is also
the ranking default: matching Indian listings are surfaced first (a stable
reorder after dedupe and round-robin interleaving, so no listing is dropped and
source diversity is preserved inside each group). The web client defaults the
location field to India. These filters are how India-focused search works: no
supported source has an India-specific API, so listings are filtered by the
location each source actually reports.

Every discovery response also includes a `shortcuts` array — one verified
search URL per platform that refuses third-party listing access (LinkedIn,
Internshala, Naukri, Wellfound, Unstop, Cutshort, Foundit). They are labeled
`kind: "search-shortcut"` with `automaticIntegration: false`, never merged into
`jobs`, and the sender builds them from the applied filters so the user can
search the platform directly in their own browser:

| Shortcut | URL shape (verified live, October 2026) |
| --- | --- |
| `linkedin` | `/jobs/search/?keywords=…&location=…&f_JT=I|F|P|C|T` (+`f_WT=2` for remote) — works logged out |
| `internshala` | Listing pages only: `/internships/`, `/internships/internship-in-<city>/`, `/internships/work-from-home-internships/`, `/jobs/` (keyword search is a POST form there) |
| `naukri` | `/<keyword>-jobs` or `/<keyword>-internship-jobs` |
| `wellfound` | `/jobs?query=…` |
| `unstop` | `/internships?search=…` |
| `cutshort` | `/jobs?query=…` |
| `foundit` | `/srp/results?query=…` (+`/jobtype/internship`); note `/search/<slug>` answers 403 |

### URL import

`POST /jobs/import-url` reads only what is publicly visible on the page:

1. schema.org `JobPosting` JSON-LD (`@graph` supported),
2. OpenGraph/meta tags as a low-confidence fallback.

No platform is integrated through an API. LinkedIn, Internshala, Wellfound,
Naukri, Indeed, Foundit, Cutshort, and Unstop offer no permitted public job API;
their pages are read as ordinary public HTML only when you paste a URL, or you
enter the job manually. Login walls, CAPTCHAs, and bot checks are detected and
returned as notes, never bypassed.

When extraction fails, the 200 response contains `extracted: false` and a
`manualImport` object listing the fields you must supply yourself:

```json
{
  "extracted": false,
  "job": null,
  "manualImport": {
    "required": ["title", "company", "description", "applicationUrl"],
    "prefill": { "title": "…", "company": "…", "applicationUrl": "https://…" },
    "note": "Automatic extraction was not possible…"
  }
}
```

The importer enforces HTTPS (plain HTTP needs an explicit dev-only flag),
rejects localhost/private/reserved addresses after DNS resolution, pins each
connection to the validated address, re-validates every redirect, and enforces a
timeout, a response-size cap, and an HTML-only content type.

### Applications

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/applications` | Yes | List with `status`, `q`, pagination |
| POST | `/applications` | Yes | Track a job with an initial status |
| PATCH | `/applications/:id` | Yes | Update status/notes/edited cover letter |
| DELETE | `/applications/:id` | Yes | Delete tracking record (job remains) |
| GET | `/applications/:id/preview` | Yes | Verified prefill + workflow disclosure |
| POST | `/applications/:id/submit` | Yes | Record user-completed submission |
| GET | `/applications/:id/readiness` | Yes | Ready for Review checklist (read-only) |
| POST | `/applications/:id/readiness` | Yes | Checklist with explicit form requirements |
| GET | `/applications/:id/autofill-plan` | Yes | Verified values + approved resume + no-submit policy |
| GET | `/applications/:id/autofill-runs` | Yes | Local helper run history |
| POST | `/applications/:id/autofill-runs` | Yes | Record a helper run (never a submission) |

`PATCH` to `submitted` is rejected with 400. Use the submit endpoint:

```json
{
  "approved": true,
  "confirmation": true,
  "method": "assisted_manual"
}
```

### Application readiness and autofill

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/autofill/adapters` | Yes | Supported/unsupported portal registry |
| GET | `/autofill/adapters/detect?url=` | Yes | Adapter matched by application hostname |

Readiness is read-only. It never changes the application status, and it
returns `statusPreserved: true` plus the unchanged `applicationStatus`.

```json
{
  "requirements": {
    "coverLetter": "required",
    "questions": ["Why do you want this role?"]
  }
}
```

`coverLetter` accepts `required`, `recommended` (default), or `off`. Screening
questions are matched only against saved answers with `approved: true`.

Readiness response highlights:

- `ready` and `blocking` (ids of required checks that failed)
- `checks[]` — `id`, `label`, `status` (`pass` / `warn` / `fail`), `required`,
  `detail`, and an optional `fix { label, href }` client route
- `missingProfile[]`, `missingAnswers[]`
- `approvedResume` (id, revision, `approvedAt`, PDF/DOCX metadata and download
  paths) or `null` when only a draft exists
- `adapter` support flags for the portal
- `submission: { automatic: false, requiresHumanClick: true }`

The autofill plan is built only from the account, verified profile, the latest
**approved** tailored revision, and approved answer-bank entries. It includes
`schemaVersion: 1`, `canAutofill`, `blockers[]`, mapped `fields[]`,
`manualValues[]` (verified values without a matching portal input), `resume`,
`coverLetter`, `answers`, `safety` (`autoSubmit: false`,
`finalSubmissionRequiresHuman: true`, forbidden actions), `manualFallback`, and
the local `helper` command. Drafts and unverified accomplishments are excluded.

Run reports accept `adapter`, `pageUrl`, `status`, `filledFields`,
`missingFields`, `validationErrors`, `unsupportedControls`, `blockedBy`,
`resumeUploaded`, `coverLetterFilled`, and `answersFilled`. Sending
`submitted: true` returns 400, and every stored run has `submitted: false`.

### AI

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/ai/status` | Yes | Whether AI is configured (never returns the key) |
| POST | `/ai/explain-match` | Yes | Deterministic match, no AI call |
| POST | `/ai/cover-letter` | Yes | Draft cover letter with template fallback |
| POST | `/ai/resume-suggestions` | Yes | Tailored suggestions with fallback |
| POST | `/ai/application-answers` | Yes | Draft answers to 1–10 questions |

AI responses include `provider` (`openai` or `template`) and, for fallbacks, a
`notice`. AI routes are rate-limited.

### Dashboard

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/dashboard` | Yes | Stats, pipeline, activity, recommendations, completion |

## Status codes

| Code | Meaning |
| --- | --- |
| 200 | Success |
| 201 | Created |
| 400 | Validation or malformed request |
| 401 | Missing, invalid, expired, or revoked token |
| 403 | Disallowed CORS origin |
| 404 | Resource not found or not owned by the user |
| 409 | Duplicate account, job, or application |
| 413 | File/body too large |
| 422 | Resume could not be parsed, or missing prerequisite |
| 429 | Rate limit exceeded |
| 500 | Unhandled server error (no internal details in production) |
| 503 | Provider unavailable or dependency not ready |

## Rate limits

- API: 600 requests / 15 minutes
- Auth: 30 requests / 15 minutes
- Resume uploads: 20 / hour
- AI generation: 60 / hour

Responses include `RateLimit-*` headers on limited routes.
