/**
 * DOM-free detectors used by the helper and its tests. The helper scans the
 * page once, then these pure functions decide whether it is allowed to proceed.
 */

const CAPTCHA_FRAME_PATTERN = /(recaptcha|hcaptcha|turnstile|captcha)/i;
// An invisible reCAPTCHA/hCaptcha script loading on a public form is not a
// challenge the user has to solve. Refuse only when the page actually presents
// a challenge (the helper passes visible frame sources and this flag).
const CAPTCHA_CHALLENGE_PATTERN =
  /(complete (?:the )?captcha|verify (?:that )?you are (?:a )?human|i'?m not a robot|please solve (?:the )?captcha|checking your browser before accessing|attention required)/i;
const LOGIN_PATTERN = /(sign in to apply|log in to apply|login to apply|create an account to apply)/i;
const OTP_PATTERN = /(verification code|one[-\s]?time code|two[-\s]?factor|authenticator code)/i;

export function detectBlockingSignals({
  pageText = "",
  frameSources = [],
  hasPasswordInput = false,
  hasOtpInput = false,
  hasVisibleCaptcha = false,
}) {
  const blockedBy = [];

  if (
    hasPasswordInput ||
    LOGIN_PATTERN.test(pageText) ||
    (frameSources.some((source) => /login|signin/i.test(source)) && hasPasswordInput)
  ) {
    blockedBy.push("login");
  }

  if (
    hasOtpInput ||
    OTP_PATTERN.test(pageText) ||
    frameSources.some((source) => OTP_PATTERN.test(source))
  ) {
    blockedBy.push("otp");
  }

  if (
    hasVisibleCaptcha ||
    CAPTCHA_CHALLENGE_PATTERN.test(pageText) ||
    frameSources.some((source) => CAPTCHA_FRAME_PATTERN.test(source))
  ) {
    blockedBy.push("captcha");
  }

  return [...new Set(blockedBy)];
}

const SUPPORTED_INPUT_TYPES = new Set([
  "",
  "text",
  "email",
  "tel",
  "url",
  "number",
  "search",
  "date",
]);

/**
 * Classifies form controls the helper cannot responsibly fill. Comboboxes,
 * rich-text editors, and payment-like inputs are reported, not guessed at.
 */
export function classifyUnsupportedControls(controls = []) {
  const unsupported = [];

  for (const control of controls) {
    const type = String(control.type || "").toLowerCase();
    const role = String(control.role || "").toLowerCase();
    const tag = String(control.tag || "").toLowerCase();
    const label = String(control.label || control.name || "").trim().slice(0, 120);

    if (role === "combobox" || tag === "select" && control.custom === true) {
      unsupported.push(`Custom dropdown${label ? `: ${label}` : ""}`);
      continue;
    }

    if (control.contentEditable) {
      unsupported.push(`Rich-text editor${label ? `: ${label}` : ""}`);
      continue;
    }

    if (type === "file") continue;

    if (
      tag === "input" &&
      !SUPPORTED_INPUT_TYPES.has(type) &&
      !["checkbox", "radio"].includes(type)
    ) {
      unsupported.push(
        `Unsupported input type "${type}"${label ? `: ${label}` : ""}`
      );
    }
  }

  return [...new Set(unsupported)];
}
