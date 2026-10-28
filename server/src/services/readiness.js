/**
 * Deterministic "Ready for Review" evaluation for a tracked application.
 *
 * Nothing here mutates the application: readiness is a read-only projection of
 * what the user has explicitly approved plus what the profile actually says.
 */

export const DEFAULT_REQUIREMENTS = Object.freeze({
  coverLetter: "recommended",
  questions: [],
});

const COVER_LETTER_MODES = ["required", "recommended", "off"];

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

export function normalizeRequirements(requirements = {}) {
  const mode = COVER_LETTER_MODES.includes(requirements.coverLetter)
    ? requirements.coverLetter
    : DEFAULT_REQUIREMENTS.coverLetter;

  const questions = Array.isArray(requirements.questions)
    ? [
        ...new Set(
          requirements.questions
            .map((question) => String(question || "").trim())
            .filter(Boolean)
        ),
      ].slice(0, 20)
    : [];

  return { coverLetter: mode, questions };
}

export function questionTokens(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

/**
 * Matches a form question against approved saved answers. Exact containment is
 * strongest; otherwise a token overlap of at least 60% is required so a vague
 * match never silently reuses the wrong answer.
 */
export function matchApprovedAnswer(question, approvedAnswers = []) {
  const normalized = questionTokens(question).join(" ");
  if (!normalized) return null;

  let best = null;

  for (const entry of approvedAnswers) {
    const candidate = questionTokens(entry.question).join(" ");
    if (!candidate) continue;

    let score = 0;
    if (candidate === normalized) score = 1;
    else if (candidate.includes(normalized) || normalized.includes(candidate)) {
      score = 0.95;
    } else {
      const left = new Set(normalized.split(" "));
      const right = new Set(candidate.split(" "));
      const intersection = [...left].filter((token) => right.has(token)).length;
      const union = new Set([...left, ...right]).size;
      score = union === 0 ? 0 : intersection / union;
    }

    if (score >= 0.6 && (!best || score > best.score)) {
      best = { answer: entry, score: Number(score.toFixed(2)) };
    }
  }

  return best;
}

export function approvedAnswerBank(profile = {}) {
  return (profile.answerBank || [])
    .filter((entry) => entry.approved && entry.question && entry.answer)
    .map((entry) => ({
      question: entry.question,
      answer: entry.answer,
      approvedAt: entry.approvedAt || null,
    }));
}

function check({
  id,
  label,
  status,
  required = true,
  detail,
  fix = null,
  missingFields = [],
}) {
  return { id, label, status, required, detail, fix, missingFields };
}

function profileFix(label, href) {
  return { label, href };
}

function contactCheck(user) {
  const profile = user.profile || {};
  const missing = [];

  if (!String(user.name || "").trim()) {
    missing.push({ field: "name", label: "Full name", href: "/profile" });
  }
  if (!String(user.email || "").trim()) {
    missing.push({ field: "email", label: "Email", href: "/profile" });
  }
  if (!String(profile.phone || "").trim()) {
    missing.push({ field: "phone", label: "Phone number", href: "/profile" });
  }
  if (!String(profile.location || "").trim()) {
    missing.push({ field: "location", label: "Location", href: "/profile" });
  }

  const blocking = missing.filter(
    (entry) => entry.field === "name" || entry.field === "email"
  );

  return check({
    id: "contact_details",
    label: "Contact details",
    status: blocking.length ? "fail" : missing.length ? "warn" : "pass",
    // A phone number is one of the most common required fields, but readiness
    // reports it as a warning instead of pretending it blocks every portal.
    required: blocking.length > 0,
    detail: missing.length
      ? `Missing: ${missing.map((entry) => entry.label).join(", ")}.`
      : "Name, email, phone, and location are present.",
    fix: profileFix("Complete profile", "/profile"),
    missingFields: missing,
  });
}

function educationCheck(profile) {
  const education = (profile.education || []).filter(
    (entry) => entry.institution || entry.degree
  );

  return check({
    id: "education",
    label: "Education",
    status: education.length ? "pass" : "warn",
    required: false,
    detail: education.length
      ? `${education.length} education ${
          education.length === 1 ? "entry" : "entries"
        } available for education questions.`
      : "No education entry yet. Many internship forms require school and graduation year.",
    fix: profileFix("Add education", "/profile"),
  });
}

function skillsCheck(profile) {
  const skills = (profile.skills || []).filter(Boolean);

  return check({
    id: "skills",
    label: "Verified skills",
    status: skills.length >= 3 ? "pass" : skills.length ? "warn" : "fail",
    required: skills.length === 0,
    detail: skills.length
      ? `${skills.length} skills will be offered; only these verified skills are used.`
      : "Add at least one skill you can defend in an interview.",
    fix: profileFix("Add skills", "/profile"),
  });
}

function experienceCheck(profile) {
  const experience = (profile.experience || []).filter(
    (entry) => entry.company || entry.title
  );
  const projects = (profile.projects || []).filter((entry) => entry.name);

  return check({
    id: "experience_or_projects",
    label: "Experience or projects",
    status: experience.length || projects.length ? "pass" : "warn",
    required: false,
    detail: experience.length || projects.length
      ? `${experience.length} experience ${
          experience.length === 1 ? "entry" : "entries"
        } and ${projects.length} ${
          projects.length === 1 ? "project" : "projects"
        } available.`
      : "Add at least one experience entry or project so the form is not blank there.",
    fix: profileFix("Add experience", "/profile"),
  });
}

function unverifiedCheck(profile) {
  let total = 0;
  for (const project of profile.projects || []) {
    for (const accomplishment of project.accomplishments || []) {
      if (accomplishment?.text && !accomplishment.verified) total += 1;
    }
  }

  return check({
    id: "verified_claims",
    label: "Verified accomplishments only",
    status: total ? "warn" : "pass",
    required: false,
    detail: total
      ? `${total} accomplishment ${
          total === 1 ? "is" : "are"
        } not marked verified. They are omitted from the tailored resume and prefill.`
      : "Every accomplishment used for applications is marked verified.",
    fix: total ? profileFix("Review accomplishments", "/profile") : null,
  });
}

function workAuthorizationCheck(profile) {
  const authorization = profile.workAuthorization || {};
  const status = authorization.status || "";
  const known = status && status !== "prefer_not_to_say";

  return check({
    id: "work_authorization",
    label: "Work authorization",
    status: known ? "pass" : "warn",
    required: false,
    detail: known
      ? `Stored as "${status.replace(/_/g, " ")}"; sponsorship answer: ${
          authorization.requiresSponsorship ? "yes" : "no"
        }.`
      : "Work authorization is not set. Answer the sponsorship question yourself instead of guessing.",
    fix: profileFix("Set work authorization", "/profile"),
  });
}

function coverLetterCheck(application, jobId, mode) {
  const body = String(application.coverLetter?.body || "").trim();

  if (mode === "off") {
    return check({
      id: "cover_letter",
      label: "Cover letter",
      status: "pass",
      required: false,
      detail: "Cover letter is not required for this review.",
    });
  }

  return check({
    id: "cover_letter",
    label: "Cover letter",
    status: body ? "pass" : mode === "required" ? "fail" : "warn",
    required: mode === "required",
    detail: body
      ? `Saved cover letter ready (${body.length} characters). Reload it before pasting.`
      : mode === "required"
        ? "This portal requires a cover letter and none is saved for this application."
        : "No cover letter saved. Optional for this review.",
    fix: body ? null : profileFix("Write a cover letter", `/jobs/${jobId}`),
  });
}

function screeningAnswersCheck(profile, questions) {
  if (!questions.length) {
    return check({
      id: "screening_answers",
      label: "Screening answers",
      status: "pass",
      required: false,
      detail: "No screening questions were supplied for this review.",
    });
  }

  const approved = approvedAnswerBank(profile);
  const matches = questions.map((question) => ({
    question,
    match: matchApprovedAnswer(question, approved),
  }));
  const missing = matches
    .filter((entry) => !entry.match)
    .map((entry) => entry.question);

  return check({
    id: "screening_answers",
    label: "Screening answers",
    status: missing.length ? "fail" : "pass",
    required: true,
    detail: missing.length
      ? `${missing.length} of ${questions.length} questions have no explicitly approved saved answer.`
      : `All ${questions.length} questions have approved saved answers. Re-read each one before reuse.`,
    fix: missing.length ? profileFix("Approve saved answers", "/profile") : null,
    missingFields: missing.map((question) => ({
      field: "answer",
      label: question,
      href: "/profile",
    })),
  });
}

/**
 * Builds the Ready for Review checklist.
 *
 * @param {object} input
 * @param {object} input.user               Mongoose user (with profile).
 * @param {object} input.job                Mongoose job.
 * @param {object} input.application        Mongoose application.
 * @param {object|null} input.approvedResume Latest approved tailored revision.
 * @param {object|null} input.latestDraft    Latest draft revision, if any.
 * @param {object} input.adapter            Detected portal adapter.
 * @param {object} input.requirements       Cover letter mode and questions.
 */
export function evaluateReadiness({
  user,
  job,
  application,
  approvedResume = null,
  latestDraft = null,
  adapter,
  requirements = DEFAULT_REQUIREMENTS,
}) {
  const profile = user.profile || {};
  const normalized = normalizeRequirements(requirements);
  const jobId = String(job._id || job.id);
  const files = approvedResume?.files || [];
  const formats = files.map((file) => file.format);
  const hasPdf = formats.includes("pdf");
  const hasDocx = formats.includes("docx");

  const checks = [
    check({
      id: "application_url",
      label: "Application page",
      status: /^https?:\/\//i.test(job.applicationUrl || "") ? "pass" : "fail",
      detail: /^https?:\/\//i.test(job.applicationUrl || "")
        ? `${adapter.name} application page is reachable by URL.`
        : "The saved application URL is not a valid http(s) address.",
      fix: profileFix("Edit job", `/jobs/${job._id || job.id}`),
    }),
    check({
      id: "approved_resume",
      label: "Approved tailored resume",
      status: approvedResume ? "pass" : "fail",
      detail: approvedResume
        ? `Revision ${approvedResume.revision} was approved on ${new Date(
            approvedResume.approvedAt || Date.now()
          ).toISOString().slice(0, 10)} for this job.`
        : latestDraft
          ? `Revision ${latestDraft.revision} is still a draft and cannot be used for an application.`
          : "No tailored resume exists for this job yet.",
      fix: approvedResume
        ? null
        : profileFix(
            latestDraft ? "Review and approve the draft" : "Generate a tailored resume",
            `/jobs/${job._id || job.id}/tailored`
          ),
    }),
    check({
      id: "resume_files",
      label: "Downloadable PDF and DOCX",
      status: hasPdf && hasDocx ? "pass" : hasPdf ? "warn" : "fail",
      detail: approvedResume
        ? hasPdf && hasDocx
          ? "Both formats are stored separately for this approved revision."
          : hasPdf
            ? "PDF is stored; the DOCX version is missing."
            : "No PDF is stored for the approved revision."
        : "Files become available after a revision is approved.",
      fix: approvedResume ? null : profileFix("Open tailored resume", `/jobs/${job._id || job.id}/tailored`),
    }),
    contactCheck(user),
    educationCheck(profile),
    skillsCheck(profile),
    experienceCheck(profile),
    workAuthorizationCheck(profile),
    coverLetterCheck(application, jobId, normalized.coverLetter),
    screeningAnswersCheck(profile, normalized.questions),
    unverifiedCheck(profile),
    check({
      id: "final_submission_guard",
      label: "You submit, not the app",
      status: "pass",
      required: true,
      detail:
        "Autofill stops before the final control. You must click Apply, Submit, or Send yourself.",
    }),
  ];

  const summary = checks.reduce(
    (accumulator, entry) => {
      accumulator.total += 1;
      if (entry.status === "pass") accumulator.passed += 1;
      else if (entry.status === "warn") accumulator.warnings += 1;
      else accumulator.failures += 1;
      return accumulator;
    },
    { total: 0, passed: 0, warnings: 0, failures: 0 }
  );

  const blocking = checks.filter(
    (entry) => entry.required && entry.status === "fail"
  );

  const missingProfile = checks
    .flatMap((entry) => entry.missingFields || [])
    .filter((entry) => entry.field !== "answer");

  return {
    applicationId: String(application._id || application.id),
    jobId: String(job._id || job.id),
    ready: blocking.length === 0,
    status: blocking.length === 0 ? "ready" : "needs_attention",
    blocking: blocking.map((entry) => entry.id),
    applicationStatus: application.status,
    statusPreserved: true,
    requirements: normalized,
    adapter: {
      key: adapter.key,
      name: adapter.name,
      supported: Boolean(adapter.supported),
      autofillSupported: Boolean(adapter.autofillSupported),
      resumeUploadSupported: Boolean(adapter.resumeUploadSupported),
      requiresLogin: Boolean(adapter.requiresLogin),
      notes: adapter.notes || "",
      unsupportedReason: adapter.unsupportedReason || "",
    },
    approvedResume: approvedResume
      ? {
          id: String(approvedResume._id || approvedResume.id),
          revision: approvedResume.revision,
          approvedAt: approvedResume.approvedAt,
          files: files.map((file) => ({
            format: file.format,
            fileName: file.fileName,
            size: file.size,
            checksum: file.checksum,
            downloadPath: `/api/tailored-resumes/${String(
              approvedResume._id || approvedResume.id
            )}/download/${file.format}`,
          })),
        }
      : null,
    checks: checks.map(({ missingFields, ...entry }) => entry),
    missingProfile,
    missingAnswers: screeningAnswerGaps(profile, normalized.questions),
    summary,
    submission: {
      automatic: false,
      requiresHumanClick: true,
      note: "This readiness report never submits an application.",
    },
  };
}

export function screeningAnswerGaps(profile, questions = []) {
  const approved = approvedAnswerBank(profile);
  return questions
    .filter((question) => !matchApprovedAnswer(question, approved))
    .map((question) => ({ question, reason: "no_approved_answer" }));
}
