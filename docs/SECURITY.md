# Security Notes

## Trust boundaries

- The browser has only a JWT and public API responses.
- The Express API holds `MONGO_URI`, `JWT_SECRET`, and optional AI keys.
- MongoDB stores users, profile data, jobs, application records, activity, and
  private resume documents.
- External services: the configured AI provider, the enabled job sources
  (Remotive, Jobicy, Arbeitnow, Remote OK, and any named Greenhouse/Lever/Ashby
  board), and
  any URL the user asks the importer to read. Only the minimum necessary content
  is sent, and only when a feature is used. No resume or profile text is sent to
  job sources.

## Authentication and sessions

- Passwords are hashed with bcrypt (`BCRYPT_ROUNDS`, default 12). Password hashes
  are excluded from default queries and removed from every serialized user.
- JWT access tokens are signed with `JWT_SECRET`, an issuer, an expiry
  (`JWT_EXPIRES_IN`, default 7 days), and a `tokenVersion`.
- Every protected request loads the user and compares the token's version to the
  stored value. Logout and password change increment `tokenVersion`, revoking
  all previously issued tokens.
- Login returns the same message for an unknown email and a wrong password.
- Registration conflicts return 409. This reveals that an email is registered;
  this is a common usability trade-off. If account enumeration is a concern, use
  a verification-email flow instead.
- Rate limiting covers all `/api` routes, auth routes, uploads, and AI requests.

Residual risks:

- The JWT is stored in `localStorage`. A successful XSS could read it. The SPA
  renders user content through React (escaped by default), uses no third-party
  scripts, and accepts only JSON from its own API. High-security deployments
  should move to short-lived access tokens plus `HttpOnly`, `Secure`,
  `SameSite` refresh cookies.
- There is no email verification, password reset, 2FA, or device/session list.
- Tokens remain valid until expiry unless logout/password change revokes them.

## Authorization

- Every job, application, resume, activity, and dashboard query is scoped by the
  authenticated user's id.
- Object ids are validated before use. A user requesting another user's resource
  receives 404, not data.
- There is no admin role and no cross-user endpoint.
- Resume downloads are served only from `/api/resumes/me/file`; there is no
  static upload directory and no public file URL.

## Resume handling

- Only PDF and DOCX extensions and MIME types are accepted.
- Magic bytes are checked (`%PDF-` for PDF, `PK` for DOCX) in addition to the
  client-provided type.
- Size is limited by multer and `UPLOAD_MAX_BYTES`.
- Files are stored in MongoDB as private documents with `fileData` and extracted
  `text` excluded from default queries.
- Parsing failures return 422; scanned image-only PDFs are rejected with a clear
  message.
- The download route sets `Cache-Control: private, no-store`,
  `Content-Disposition: attachment`, and `X-Content-Type-Options: nosniff`.
- Files are not virus-scanned. If untrusted users upload files, add an antivirus
  scanning step before parsing or storage.
- Extracted resume text is sent to the AI provider only when the user explicitly
  requests an AI feature. Profile contact details are not included in the prompt,
  but name, headline, summary, skills, education, and experience are.
- The extraction review and apply endpoints are scoped to the authenticated
  owner's resume and return `Cache-Control: private, no-store`. Reviewing performs
  no writes. Applying requires `reviewed: true`, and non-empty profile values are
  skipped unless the request explicitly sets `overwriteVerified: true`.
- Answer-bank entries are only offered to the preview after the user marks them
  approved. Unapproved drafts are never serialized into the preview payload.
- Project accomplishments carry a per-item `verified` flag; resume-extracted
  accomplishments are saved as unverified until the user ticks them.

## Tailored resume handling

- Generation reads the owner's profile and original resume; it never writes to
  the original resume document.
- Only verified profile facts are copied: skills are reordered, not invented, and
  unverified accomplishments are omitted.
- Every revision is owner-scoped. Detail, edit, approval, regeneration, and
  download queries all filter by the authenticated user; foreign ids return 404.
- PDF and DOCX buffers are stored with `select: false`, omitted from JSON, and
  served only through the authenticated download route with
  `Cache-Control: private, no-store`, `Content-Disposition: attachment`, and
  `X-Content-Type-Options: nosniff`.
- Approval is explicit (`approved: true`) and stamps `approvedAt`. Approved
  revisions are immutable; editing returns 409 and regeneration creates a new
  draft revision.
- The application preview exposes only an approved revision. A newer draft is
  reported as `draftAvailable` but its content and files are not offered.
- An AI provider may rewrite the summary. It is prompted to use only supplied
  facts, any provider failure falls back to deterministic text, and the resume
  must still be reviewed and approved by the user.

## API input and output

- Zod validates request bodies, params, and query strings. Unknown fields are
  stripped.
- Mongoose schemas enforce types, lengths, enums, and array limits.
- Search inputs are escaped before being used in regular expressions.
- Pagination is capped at 50 items per page, reducing oversized responses.
- Error responses are consistent and do not include stack traces in production.
- JSON and URL-encoded bodies are limited to 1 MB.
- The AI provider's response is parsed and validated; malformed, incomplete, or
  oversized content falls back to a labeled template.

## Network and browser controls

- Helmet sets baseline security headers.
- CORS uses an explicit allowlist from `CLIENT_URL`. Requests without an Origin
  (curl, server-to-server) are allowed; unknown browser origins are rejected
  with 403. In non-production environments, loopback origins are also allowed
  for local Vite development.
- `credentials` is disabled because the API uses bearer tokens, not cookies.
- Rate limits: 600 API requests/15 min, 30 auth attempts/15 min, 20 uploads/hour,
  20 URL imports/15 min, 60 AI generations/hour. These are per process;
  multi-instance deployments need a shared store such as Redis for consistent
  limits.

## Outbound requests (job discovery and URL import)

Job discovery calls fixed provider endpoints built from hard-coded base URLs plus
validated board names (`[a-zA-Z0-9_-]{1,80}`), so a client cannot redirect it to
an arbitrary host. Each request has an 8s default timeout, and one slow or broken
source cannot affect the others.

Remote OK's public API terms require attribution with a link back to Remote OK.
Discovery responses that include Remote OK listings carry its attribution line,
and the UI renders every attribution URL as a follow link. No credentials are
sent to any job source, with one deliberate exception: the Adzuna adapter sends
the owner's own Adzuna `app_id`/`app_key` query parameters to `api.adzuna.com`,
the documented official API endpoint, exactly as its terms require. The keys
never leave the server, and shortcut URLs for platforms without a permitted
listing API carry no credentials and no scraping — they are ordinary search
links the user opens in their own browser.

URL import handles user-supplied URLs, so it applies SSRF defenses:

- HTTPS only; plain HTTP requires `URL_IMPORT_ALLOW_HTTP=true`, which the
  environment schema rejects in production.
- No embedded credentials.
- Only ports 80/443 unless the private-host escape hatch is enabled.
- `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.lan`, metadata
  hostnames, and reserved suffix names are blocked.
- IPv4 and IPv6 addresses are checked for loopback, private, link-local, CGNAT,
  multicast, documentation, and unique-local ranges (including IPv4-mapped IPv6).
- Every DNS answer is validated; a single private answer rejects the URL.
- The connection is pinned to the validated address via a custom `lookup`, so a
  second DNS answer cannot redirect the socket (DNS rebinding).
- Redirects are followed manually (max 3) and every hop is re-validated.
- The whole fetch has a deadline and a byte cap; only HTML/text content types are
  accepted.
- `URL_IMPORT_ALLOW_PRIVATE_HOSTS` is a development/test escape hatch and is
  rejected in production.
- No login, CAPTCHA, OTP, or access-control bypass: blocked pages return the
  manual-import fallback.
- `trust proxy` is enabled only in production so Render's proxy headers are
  honored by the rate limiter.

### Environment validation (verified)

The server refuses to start in `NODE_ENV=production` unless configuration is
safe. Each rule below was exercised against the real config module and
produced the documented abort message:

- `MONGO_URI` required; `JWT_SECRET` required and at least 32 characters.
- `URL_IMPORT_ALLOW_HTTP=true` rejected (plain HTTP imports off in production).
- `URL_IMPORT_ALLOW_PRIVATE_HOSTS=true` rejected (SSRF escape hatch closed).
- `AI_PROVIDER=openai` without `AI_API_KEY` rejected.
- `CLIENT_URL` origins must be valid HTTP(S); comma-separated lists become the
  CORS allowlist.
- In development, missing secrets fall back to a documented insecure default
  with a startup warning.

A live production-mode run with the real database confirmed: health and
readiness 200 with `database: "connected"`, 403 for a disallowed CORS origin,
200 plus `Access-Control-Allow-Origin` for the configured origin, 401 with a
request id for unauthenticated API calls, rate-limit policy headers, Helmet
security headers, and structured logs with no secrets or bodies.

## Logging and secrets

- Structured JSON logs include request id, method, path (without query string),
  status, and duration.
- A redaction helper removes keys containing password, token, authorization,
  secret, API key, cookie, or resume content.
- Request bodies are never logged.
- Resume text is never logged.
- `.env` files are ignored by Git, including `.env.*` except `.env.example`.
- Secrets belong in Render/Vercel dashboards, never in the repository.
- The frontend has no access to backend secrets.

## Application workflow safety

- There is no automated form submission.
- There is no CAPTCHA, MFA, anti-bot, or access-control bypass.
- There is no LinkedIn scraping or automation.
- The preview endpoint returns verified profile values and instructions.
- Marking an application submitted requires the dedicated endpoint with
  `approved: true` and `confirmation: true`. The UI additionally requires the
  user to check an approval box.
- The recorded method is `manual` or `assisted_manual`, making the distinction
  between app-assisted and automated behavior explicit.

## Browser-assisted autofill

- **Local only.** The Playwright helper runs on the user's machine from
  `tools/autofill`. The server never launches a browser, never receives a
  session cookie, and never proxies an employer form.
- **No submission path.** `tools/autofill/lib/fill.js` contains no `click()`
  call, no `submit()`, no `requestSubmit`, and no fetch/navigation after filling.
  Final controls are scanned only to be reported to the user.
- **Shared guard.** `server/src/services/autofill/safety.js` classifies submit
  controls and is imported by both the API and the helper, so one definition is
  tested everywhere. The helper refuses a plan whose `safety.autoSubmit` is not
  exactly `false` or whose `canAutofill` is not `true`.
- **Approved material only.** Plans use the latest approved tailored revision
  (PDF/DOCX), verified profile values, and answer-bank entries with
  `approved: true`. Drafts and unverified accomplishments are excluded server
  side, not hidden in the UI.
- **Ownership.** Readiness, plans, and run reports are scoped to `req.user` and
  return 404 for another account's application. Plans and run reports are
  `Cache-Control: private, no-store`.
- **Submission cannot be recorded through a run.** `submitted: true` is rejected
  with 400; stored runs have an immutable `submitted: false`. Only the separate
  submit endpoint, requiring `approved` and `confirmation`, records a submission.
- **No protection bypass.** Login, password, CAPTCHA, OTP, and MFA signals stop
  the run before filling. The helper never enters credentials, accepts terms, or
  creates accounts.
- **Data handling.** A downloaded plan contains personal data (name, email,
  phone, location, links, resume download paths). Treat it as private, keep it
  out of Git and shared folders, and delete it after use. In fetch mode the CLI
  downloads resume files to an OS temp directory with mode `0600`.
- **Selector drift.** Adapters are hostname-scoped, maintained in source, and
  best-effort. Unknown or changed forms produce `missingFields` reports rather
  than guessed values.

## Production checklist

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` at least 32 random characters, stored only in the host
- [ ] `CLIENT_URL` exact production origin(s), no wildcard
- [ ] Atlas user is least-privilege and password is URL-encoded
- [ ] Atlas network access restricted as much as the plan allows
- [ ] `MONGO_URI` and AI keys set only on the backend host
- [ ] No `.env` files in Git (`git status --ignored`)
- [ ] HTTPS on both frontend and backend (Render/Vercel provide it)
- [ ] Health and readiness checks tested
- [ ] Rate limits verified under expected traffic
- [ ] Antivirus scanning added if uploads come from untrusted users
- [ ] Token storage reviewed against your threat model
- [ ] Logs inspected for accidental sensitive data (they should contain none)
- [ ] Autofill plan files and `.autofill-profile/` kept out of Git and deleted
      after use
- [ ] Autofill helper dependencies installed only on machines that need them
      (the server never requires Playwright)
- [ ] Provider cost and data-retention terms reviewed before enabling AI

## Reporting

This is a portfolio/learning project, not a managed security service. Add a
security contact and disclosure policy before operating it for real users.
