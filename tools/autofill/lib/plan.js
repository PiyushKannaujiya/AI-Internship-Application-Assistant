/**
 * Plan handling and report shaping. These functions are DOM-free so they can be
 * tested without launching a browser.
 */
import { matchApprovedAnswer } from "../../../server/src/services/readiness.js";

export class PlanError extends Error {
  constructor(message, code = "PLAN_INVALID") {
    super(message);
    this.name = "PlanError";
    this.code = code;
  }
}

export function validatePlanSafety(plan) {
  if (!plan || typeof plan !== "object") {
    throw new PlanError("The autofill plan is empty or unreadable.", "PLAN_MISSING");
  }

  if (plan.schemaVersion !== 1) {
    throw new PlanError(
      `Unsupported plan schema version "${plan.schemaVersion}". Regenerate the plan from the API.`,
      "PLAN_VERSION"
    );
  }

  if (plan.safety?.autoSubmit !== false) {
    throw new PlanError(
      "Refusing to run: the plan does not explicitly disable automatic submission.",
      "SAFETY_POLICY_MISSING"
    );
  }

  if (plan.safety?.finalSubmissionRequiresHuman !== true) {
    throw new PlanError(
      "Refusing to run: the plan does not require a human final submission.",
      "SAFETY_POLICY_MISSING"
    );
  }

  if (plan.canAutofill !== true) {
    const reason =
      (plan.blockers || [])
        .map((blocker) => blocker.detail)
        .filter(Boolean)
        .join(" ") || "The plan is not ready for autofill.";
    throw new PlanError(reason, "PLAN_BLOCKED");
  }

  if (!Array.isArray(plan.fields)) {
    throw new PlanError("The plan has no field list.", "PLAN_INVALID");
  }

  return plan;
}

/**
 * Chooses the resume file to attach. PDF wins because every supported adapter
 * accepts it; DOCX is used only when no PDF path was supplied.
 */
export function selectResumeFile(plan, paths = {}) {
  const files = plan?.resume?.files || [];
  const hasPdf = files.some((file) => file.format === "pdf");
  const hasDocx = files.some((file) => file.format === "docx");

  if (hasPdf && paths.pdf) {
    return {
      format: "pdf",
      path: paths.pdf,
      fileName: files.find((file) => file.format === "pdf")?.fileName || "resume.pdf",
    };
  }

  if (hasDocx && paths.docx) {
    return {
      format: "docx",
      path: paths.docx,
      fileName:
        files.find((file) => file.format === "docx")?.fileName || "resume.docx",
    };
  }

  return null;
}

export function selectorsFor(field = {}) {
  return Array.isArray(field.selectors)
    ? field.selectors.filter((selector) => typeof selector === "string" && selector)
    : [];
}

export function labelsFor(field = {}) {
  return Array.isArray(field.labels)
    ? field.labels.filter((label) => typeof label === "string" && label.trim())
    : [];
}

/**
 * Matches a question label found on the page to an approved saved answer using
 * the same matcher the readiness report uses.
 */
export function matchAnswerForQuestion(question, answers = []) {
  const match = matchApprovedAnswer(question, answers);
  return match ? match.answer : null;
}

export function buildRunReport({
  plan,
  pageUrl = "",
  filledFields = [],
  missingFields = [],
  validationErrors = [],
  unsupportedControls = [],
  blockedBy = [],
  resumeUploaded = null,
  coverLetterFilled = false,
  answersFilled = [],
  answersNotFilled = [],
  finalSubmissionControls = [],
  botProtection = { detected: false, visibleChallenge: false, kinds: [] },
  notes = "",
}) {
  const hasProblems =
    missingFields.length > 0 ||
    validationErrors.length > 0 ||
    unsupportedControls.length > 0 ||
    answersNotFilled.length > 0;

  const status =
    blockedBy.length > 0
      ? "failed"
      : hasProblems
        ? "needs_review"
        : "prepared";

  return {
    adapter: plan.adapter?.key || "generic",
    pageUrl,
    status,
    filledFields,
    missingFields: [
      ...missingFields,
      ...answersNotFilled.map((question) => ({
        canonical: "answer",
        label: question,
        reason: "no_matching_textarea",
      })),
    ],
    validationErrors,
    unsupportedControls,
    blockedBy,
    resumeUploaded,
    coverLetterFilled,
    answersFilled,
    submitted: false,
    botProtection,
    notes,
    finalSubmissionControls,
  };
}
