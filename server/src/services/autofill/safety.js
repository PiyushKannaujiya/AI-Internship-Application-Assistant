/**
 * Shared no-submit policy for the local autofill helper.
 *
 * This module is intentionally dependency free and lives on the server so the
 * API can describe the same policy it enforces. The Playwright helper imports
 * it directly, and tests exercise both sides against one definition.
 */

export const SUBMIT_GUARD_CODE = "SUBMIT_GUARD_BLOCKED";

export class SubmitGuardError extends Error {
  constructor(control = {}) {
    const label = control.text || control.ariaLabel || control.name || "control";
    super(
      `Refusing to interact with a final submission control ("${label}"). Submit the application yourself.`
    );
    this.name = "SubmitGuardError";
    this.code = SUBMIT_GUARD_CODE;
    this.control = control;
  }
}

const SUBMISSION_PATTERNS = [
  /\bsubmit\b/i,
  /\bapply\b/i,
  /\bapply now\b/i,
  /\bsend application\b/i,
  /\bsend my application\b/i,
  /\bsubmit application\b/i,
  /\bcomplete application\b/i,
  /\bfinish application\b/i,
  /\bsend\b.*\bapplication\b/i,
];

// Controls that are never the final submission even though they contain a
// blocked word, so the helper can still describe them accurately.
const NON_SUBMISSION_PATTERNS = [
  /\bsubmit later\b/i,
  /\bsave\b/i,
  /\bdraft\b/i,
  /\bpreview\b/i,
  /\bapply (?:a )?filter/i,
  /\bapply (?:this )?coupon/i,
];

export const SAFETY_POLICY = Object.freeze({
  autoSubmit: false,
  finalSubmissionRequiresHuman: true,
  hiddenSubmissionAllowed: false,
  clicksAllowed: false,
  credentialsHandled: false,
  allowedActions: [
    "Type verified profile values into visible form fields",
    "Select options that already exist in a form",
    "Attach the approved tailored resume file to a file input",
    "Leave the page open for your review",
  ],
  forbiddenActions: [
    "Clicking Apply, Submit, Send application, or any final submission control",
    "Submitting a form programmatically, through hidden requests, or in the background",
    "Bypassing CAPTCHA, OTP, MFA, or login protections",
    "Creating accounts or entering passwords on your behalf",
    "Accepting terms, consent, or legal agreements for you",
  ],
  blockedSignals: ["captcha", "otp", "mfa", "login", "terms", "unsupported_form"],
});

export function normalizeControlLabel(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/[\u200b-\u200d\uFEFF]/g, "")
    .trim()
    .slice(0, 200);
}

/**
 * Classifies a DOM control by its visible label and attributes.
 * Anything that looks like a final submission is blocked.
 */
export function classifyControl(control = {}) {
  const label = normalizeControlLabel(
    control.text || control.ariaLabel || control.value || control.name || ""
  );
  const type = String(control.type || "").toLowerCase();
  const role = String(control.role || "").toLowerCase();
  const tag = String(control.tag || "").toLowerCase();

  if (!label && !type) {
    return { isFinalSubmission: false, label, reason: "" };
  }

  if (NON_SUBMISSION_PATTERNS.some((pattern) => pattern.test(label))) {
    return { isFinalSubmission: false, label, reason: "" };
  }

  // A styled submit button still posts the form even when its label is vague.
  if (type === "submit") {
    return { isFinalSubmission: true, label, reason: "submit_input" };
  }

  const matched = SUBMISSION_PATTERNS.find((pattern) => pattern.test(label));
  if (matched && (role === "button" || tag === "button" || tag === "a" || !tag)) {
    return { isFinalSubmission: true, label, reason: "submission_label" };
  }

  return { isFinalSubmission: false, label, reason: "" };
}

export function isFinalSubmissionControl(control = {}) {
  return classifyControl(control).isFinalSubmission;
}

export function assertNotFinalSubmission(control = {}) {
  if (isFinalSubmissionControl(control)) throw new SubmitGuardError(control);
  return control;
}

/**
 * Splits a list of scanned controls into the ones the helper must never touch
 * and the ones it may describe. Used for run reports and for tests.
 */
export function partitionControls(controls = []) {
  const submissionControls = [];
  const otherControls = [];

  for (const control of controls) {
    const classification = classifyControl(control);
    if (classification.isFinalSubmission) {
      submissionControls.push({ ...control, label: classification.label });
    } else {
      otherControls.push(control);
    }
  }

  return { submissionControls, otherControls };
}
