# Browser-Assisted Autofill (local, visible, never submits)

ApplyPilot can prepare a job application in a real browser window using an
approved tailored resume, verified profile values, and explicitly approved
saved answers. The helper is a **local Playwright script**. It is not a hosted
service, it does not run in the background, and it cannot submit an application.

## Hard rules

These are enforced in code, not just documented:

| Rule | Where it lives |
| --- | --- |
| Never click Apply, Submit, Send application, or any final control | `tools/autofill/lib/fill.js` has no `click()` call at all; `server/src/services/autofill/safety.js` classifies every scanned control and reports it |
| Never submit through hidden requests | The helper performs no form submit, `requestSubmit`, fetch, or navigation after filling |
| Never bypass CAPTCHA, OTP, MFA, or login | `tools/autofill/lib/detect.js` stops before filling when it detects them |
| Never enter credentials or accept terms | The helper types only approved application values; a password field blocks the run |
| Never use a draft resume | The plan is built from the latest **approved** tailored revision only |
| Never overwrite the application status | Readiness and plan endpoints are read-only; run reports cannot set `submitted` |

The final click is yours. After the helper fills the form it leaves the browser
open and waits for you to review and submit.

## Prerequisites

1. A tracked application (`Start tracking` on the job page).
2. An **approved** tailored resume for that job (Phase 5). Drafts are rejected.
3. Node 20.19+ and the helper's optional Playwright dependency:

```bash
cd tools/autofill
npm install
npx playwright install chromium
```

The server and client do not depend on Playwright. If it is missing, the live
browser test skips itself and the CLI prints an install hint.

## Workflow

1. Open a tracked job. The **Ready for Review** card shows the checklist:
   approved resume and files, contact details, education, skills, experience or
   projects, work authorization, cover letter requirements, screening answers,
   unverified claims, and the final-submission guard.
2. Fix anything marked **Missing**. Links open the relevant page (tailored
   resume, profile, resume upload).
3. Click **Download autofill plan**. The JSON file contains verified values, the
   approved resume download paths, approved answers, the saved cover letter, the
   adapter, and the no-submit policy.
4. Run the helper locally:

```bash
node tools/autofill/cli.js --plan ~/Downloads/applypilot-autofill-acme-frontend-intern.json \
  --resume-pdf ~/Downloads/meera-tailored.pdf
```

Or let the helper fetch the plan and approved resume from your own API:

```bash
node tools/autofill/cli.js \
  --api http://localhost:5000/api \
  --application <applicationId> \
  --token "$APPLYPILOT_TOKEN"
```

5. The browser opens **visible** on the employer's page. The helper fills mapped
   text fields, selects matching options, attaches the approved PDF (or DOCX if
   no PDF exists), fills the saved cover letter, and fills saved answers whose
   wording matches a visible question.
6. Review every field. Submit the application yourself. Close the helper with
   Enter; nothing is submitted by it.

### What gets filled

| Data | Behavior |
| --- | --- |
| Name, email, phone, location, LinkedIn, GitHub, portfolio | Filled into matching text inputs |
| Current title and company | Filled when the form exposes those inputs |
| School, degree, field of study, graduation year | Filled when the form exposes education inputs |
| Verified skills | Filled into a skills input/textarea if one exists; otherwise available in `manualValues` for copy/paste |
| Summary | From the approved revision; available in `manualValues` and the cover-letter textarea when present |
| Experience and projects | Included in the plan as verified snapshots (unverified accomplishments removed). Greenhouse/Lever/Ashby do not expose generic free-text fields for them, so there is nothing to auto-fill; use the snapshots when a form asks |
| Approved saved answers | Filled into a visible textarea whose label matches the saved question (60% token overlap or containment) |
| Cover letter | Filled from the application's saved cover letter |
| Approved resume | PDF attached (DOCX only when no PDF exists) |

Fields a portal does not expose are reported in `missingFields`; they are not
invented or forced into unrelated controls.

### CLI options

| Option | Purpose |
| --- | --- |
| `--plan <file>` | Plan JSON downloaded from the app |
| `--application <id>` | Fetch the plan from the API instead |
| `--token <jwt>` | API token for `--application` and run reporting |
| `--api <url>` | API base URL, default `http://localhost:5000/api` |
| `--resume-pdf`, `--resume-docx` | Local approved resume files |
| `--url <url>` | Override the application URL |
| `--profile-dir <dir>` | Persistent Chromium profile, default `.autofill-profile` |
| `--report <file>` | Write the run report as JSON |
| `--headless` | Tests only; normal runs are visible |
| `--no-wait` | Close after filling instead of waiting for you |

Exit codes: `0` completed, `1` could not load or run, `2` refused (unsupported
portal, unapproved resume, unsafe plan).

## Supported portals

Adapters live in [server/src/services/autofill/adapters.js](../server/src/services/autofill/adapters.js)
and are matched by hostname.

| Portal | Adapter | Autofill | Resume upload | Live employer form tested |
| --- | --- | --- | --- | --- |
| Greenhouse (`greenhouse.io`, `boards.greenhouse.io`, `job-boards.greenhouse.io`) | greenhouse | Yes | Yes | **Yes** — real public job-boards form: 6 fields filled (`#first_name`, `#last_name`, `#email`, `#phone`, `#candidate-location`, LinkedIn label), PDF attached, 6 custom dropdowns (incl. EEO) reported as unsupported instead of touched, invisible reCAPTCHA detected (not touched), 2 submission controls left untouched |
| Lever (`lever.co`, `jobs.lever.co`) | lever | Yes | Yes | **Yes** — real public `/apply` form: 6 fields filled, PDF attached, invisible reCAPTCHA/hCaptcha scripts detected (not touched), 2 submission controls left untouched |
| Ashby (`ashbyhq.com`, `jobs.ashbyhq.com`) | ashby | Yes | Yes | **Yes** — real public `/application` form: `_systemfield_name`, `_systemfield_email`, and the LinkedIn Profile label filled, PDF attached to `_systemfield_resume` (not the "Autofill from resume" helper), 1 submission control left untouched |
| LinkedIn Easy Apply | linkedin | No | No | Not attempted (login + terms) |
| Workday | workday | No | No | Not attempted (account-gated multi-step flow) |
| Any other host | generic | No | No | Manual fallback |

Live runs used clearly marked dummy data, never submitted, and never clicked a
submission control. Fields a real form does not expose are reported as
`field_not_found` instead of guessed. Treat adapter selectors for untested
portals as maintained best-effort hints, not guarantees.

## Robustness behaviors

These behaviors were added after real-page runs surfaced each failure mode,
and each is covered by a regression test in `server/tests/autofillBrowser.test.js`:

- **Dynamic React forms** — Ashby and some Greenhouse boards mount their form
  roughly two seconds after page load. The helper waits, bounded, for one of
  the adapter's own selectors before scanning; if nothing appears it reports
  `form_not_found` for every planned field and stops (nothing is typed).
- **Hidden template text is not a validation error** — Lever ships permanent
  hidden `"file exceeds max size"` template paragraphs. Only visible nodes are
  counted as validation errors, so a clean fill is not reported as dirty.
- **Hidden inputs are not unsupported controls** — hidden radio/checkbox
  groups are filtered from `unsupportedControls`; only controls a human could
  actually see and use are listed.
- **Invisible bot protection vs. a visible challenge** — reCAPTCHA/hCaptcha
  loader scripts on public forms are recorded in `botProtection.kinds` but do
  not block the run; only a visible challenge does, and it stops the helper
  before any filling.
- **Ashby resume field selection** — Ashby exposes two file inputs (a top
  "Autofill from resume" parser helper and the actual application field). The
  adapter targets `_systemfield_resume` first so the approved PDF is never
  attached to the parser helper.

## What the helper reports

Every run produces a report with:

- `filledFields` — canonical field, label, selector used
- `missingFields` — field not found, option not found, no approved file, etc.
- `validationErrors` — page-stored value mismatches and visible validation text
- `unsupportedControls` — custom dropdowns, rich-text editors, unsupported inputs
- `blockedBy` — `login`, `captcha`, `otp`, `mfa`, `terms`, `unsupported_form`
- `resumeUploaded`, `coverLetterFilled`, `answersFilled`
- `finalSubmissionControls` — labels only; never clicked
- `submitted: false` — unconditionally

With `--token` and `--application`, the report is posted to
`POST /api/applications/:id/autofill-runs`. The API rejects any report that
claims `submitted: true` and stores every run with `submitted: false`.

## Manual fallback

When a portal is unsupported or the page requires login/MFA/CAPTCHA, the helper
exits before typing and prints the manual instructions. The application preview
in the app shows the same verified values and approved answers for copy/paste.
Unsupported forms are never forced.

## Troubleshooting

- **"No approved resume file is available"** — approve a tailored revision for
  this job, or pass `--resume-pdf` explicitly.
- **"This portal has no maintained adapter"** — use the manual fallback. Do not
  add a selector you have not inspected; adapters are code-reviewed.
- **"Refusing to run: plan does not explicitly disable automatic submission"** —
  regenerate the plan from the app. The helper refuses hand-edited plans that
  drop the safety block.
- **Browser opens but nothing is filled** — the page may be a multi-step gate,
  a CAPTCHA-protected form, or a custom React control. Read the printed report;
  the missing list names the fields.
