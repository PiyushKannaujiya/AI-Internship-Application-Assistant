/**
 * Fills a visible application page and returns a report.
 *
 * Hard rules enforced here:
 *  - no `click()` calls anywhere;
 *  - no form submission, request, navigation, or keyboard shortcut;
 *  - the final submission controls are only described, never touched.
 */
import { partitionControls } from "./guard.js";
import {
  buildRunReport,
  labelsFor,
  matchAnswerForQuestion,
  selectorsFor,
} from "./plan.js";
import {
  classifyUnsupportedControls,
  detectBlockingSignals,
} from "./detect.js";

const MAX_TEXT_LENGTH = 4000;
const CONTROL_SCAN_LIMIT = 400;
// React-based portals (Ashby, some Greenhouse boards) mount their form ~2s
// after load. Wait, bounded, for the adapter's own selectors instead of
// declaring every field missing on an empty DOM.
const FORM_WAIT_TIMEOUT_MS = 15000;

async function waitForMappedForm(page, plan) {
  const selectors = (plan.fields || []).flatMap(selectorsFor);
  if (selectors.length === 0) return false;

  const deadline = Date.now() + FORM_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      try {
        if ((await page.locator(selector).count()) > 0) return true;
      } catch {
        // Invalid selector hint: skip it.
      }
    }
    await page.waitForTimeout(250);
  }

  return false;
}

// Adapter hints like `input[name*="linkedin" i]` can also match unrelated
// checkboxes ("How did you hear about us? -> LinkedIn"). Only accept controls
// this helper can actually type into; checkboxes and radios stay untouched and
// are reported as unsupported.
async function isTextEntryControl(locator) {
  return locator
    .evaluate((element) => {
      const tag = element.tagName.toLowerCase();
      if (tag === "textarea" || tag === "select") return true;
      if (tag !== "input") return false;
      const type = String(element.getAttribute("type") || "").toLowerCase();
      return type === "" || type === "text" || type === "email" || type === "tel" ||
        type === "url" || type === "number" || type === "search" || type === "date";
    })
    .catch(() => false);
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector);
      const count = await locator.count();
      const limit = Math.min(count, 10);
      for (let index = 0; index < limit; index += 1) {
        const candidate = locator.nth(index);
        const visible = await candidate.isVisible().catch(() => false);
        if (visible && (await isTextEntryControl(candidate))) {
          return { locator: candidate, selector };
        }
      }
    } catch {
      // Invalid or unsupported selector: try the next maintained hint.
    }
  }
  return null;
}

async function labeledFallback(page, label) {
  if (!label) return null;
  try {
    const locator = page.getByLabel(label, { exact: false });
    const count = await locator.count();
    for (let index = 0; index < Math.min(count, 10); index += 1) {
      const candidate = locator.nth(index);
      const visible = await candidate.isVisible().catch(() => false);
      if (visible && (await isTextEntryControl(candidate))) return candidate;
    }
  } catch {
    // No accessible label; reported as missing.
  }
  return null;
}

async function locateField(page, field) {
  const bySelector = await firstVisible(page, selectorsFor(field));
  if (bySelector) return bySelector;

  // Adapter labels are explicit, per-field hints (for example Ashby's
  // "LinkedIn Profile"), so they are safer than a generic substring fallback.
  for (const label of labelsFor(field)) {
    const candidate = await labeledFallback(page, label);
    if (candidate) return { locator: candidate, selector: `label:${label}` };
  }

  const generic = await labeledFallback(page, field.label);
  return generic ? { locator: generic, selector: `label:${field.label}` } : null;
}

function captchaKinds(text = "") {
  const value = String(text).toLowerCase();
  const kinds = [];
  if (value.includes("recaptcha")) kinds.push("recaptcha");
  if (value.includes("hcaptcha")) kinds.push("hcaptcha");
  if (value.includes("turnstile")) kinds.push("turnstile");
  if (kinds.length === 0 && value.includes("captcha")) kinds.push("captcha");
  return kinds;
}

async function pageSignals(page) {
  // Bot-protection scripts (especially reCAPTCHA Enterprise) load shortly
  // after DOMContentLoaded. Give them a moment so the report is accurate.
  await page.waitForTimeout(500);
  const pageText = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "");
  const frameSources = page.frames().map((frame) => frame.url());
  const hasPasswordInput =
    (await page.locator('input[type="password"]').count().catch(() => 0)) > 0;
  const hasOtpInput =
    (await page
      .locator('input[autocomplete="one-time-code"], input[name*="otp" i]')
      .count()
      .catch(() => 0)) > 0;

  // Invisible reCAPTCHA/hCaptcha Enterprise scripts load on many public forms
  // even though no challenge is shown until the human submits. Distinguish
  // those scripts from an actual visible challenge so the helper can fill the
  // form without touching (or bypassing) bot protection.
  const domCaptcha = await page
    .evaluate(() => {
      const selectors = [
        'script[src*="recaptcha" i]',
        'script[src*="hcaptcha" i]',
        'script[src*="turnstile" i]',
        'iframe[src*="recaptcha" i]',
        'iframe[src*="hcaptcha" i]',
        'iframe[src*="turnstile" i]',
        ".g-recaptcha",
        ".h-captcha",
        "#h-captcha",
        "[data-sitekey]",
        '[id*="captcha" i]',
        '[name*="captcha" i]',
      ];

      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width >= 40 &&
          rect.height >= 20 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) > 0.01
        );
      };

      const nodes = Array.from(document.querySelectorAll(selectors.join(",")));
      const visibleChallengeFrames = [];
      const nodeSignals = [];
      let visibleChallenge = false;

      for (const element of nodes) {
        const tag = element.tagName.toLowerCase();
        const src = element.getAttribute("src") || "";
        const className = String(element.className || "");
        nodeSignals.push(
          [tag, src, className, element.id, element.getAttribute("name") || ""].join(" ")
        );

        const isBadge = /grecaptcha-(badge|logo)|hcaptcha-badge/i.test(className);
        const isHiddenSize = /size=invisible/i.test(src);
        const isEnclave = /hcaptcha-enclave/i.test(src);

        if (!visible(element) || isBadge || isHiddenSize || isEnclave) continue;
        // Hidden bookkeeping inputs are not a visible challenge.
        if (["input", "textarea", "button"].includes(tag) && !element.dataset.sitekey) {
          continue;
        }

        visibleChallenge = true;
        if (tag === "iframe" && src) visibleChallengeFrames.push(src);
      }

      return { visibleChallenge, visibleChallengeFrames, nodeSignals };
    })
    .catch(() => ({ visibleChallenge: false, visibleChallengeFrames: [] }));

  const allCaptchaSources = [
    ...frameSources,
    ...domCaptcha.visibleChallengeFrames,
    ...(domCaptcha.nodeSignals || []),
  ];
  const kinds = [...new Set(captchaKinds(allCaptchaSources.join(" ")))];
  const botProtection = {
    // A loaded captcha script counts as bot protection even when invisible.
    detected: kinds.length > 0,
    visibleChallenge: Boolean(domCaptcha.visibleChallenge),
    kinds,
  };

  return {
    pageText,
    // Only visible challenge frames are passed to the blocker. Invisible badge
    // and enterprise frames are reported, never interacted with.
    frameSources: domCaptcha.visibleChallengeFrames,
    hasPasswordInput,
    hasOtpInput,
    hasVisibleCaptcha: botProtection.visibleChallenge,
    botProtection,
  };
}

async function scanControls(page) {
  return page.evaluate((limit) => {
    return Array.from(
      document.querySelectorAll(
        'button, input[type="submit"], input[type="button"], a[role="button"], [role="button"]'
      )
    )
      .slice(0, limit)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type") || "",
        role: element.getAttribute("role") || "",
        text:
          element.innerText ||
          element.textContent ||
          element.getAttribute("value") ||
          "",
        ariaLabel: element.getAttribute("aria-label") || "",
        name: element.getAttribute("name") || "",
      }));
  }, CONTROL_SCAN_LIMIT);
}

async function scanUnsupported(page) {
  const controls = await page.evaluate((limit) => {
    // Hidden inputs (CSRF, timezone, ids) are bookkeeping, not user controls.
    // Reporting them would bury the ones a human has to finish by hand.
    const visible = (element) =>
      Boolean(
        element.offsetWidth || element.offsetHeight || element.getClientRects().length
      );

    return Array.from(
      document.querySelectorAll("input, select, textarea, [contenteditable='true']")
    )
      .filter(visible)
      .slice(0, limit)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type") || "",
        role: element.getAttribute("role") || "",
        label:
          element.labels?.[0]?.innerText ||
          element.closest("label")?.innerText ||
          element.getAttribute("aria-label") ||
          element.getAttribute("placeholder") ||
          element.getAttribute("name") ||
          "",
        contentEditable:
          element.getAttribute("contenteditable") === "true" ||
          element.isContentEditable === true,
        custom: element.getAttribute("data-custom") === "true",
      }));
  }, CONTROL_SCAN_LIMIT);

  return classifyUnsupportedControls(controls);
}

async function fillTextControl(locator, value) {
  const info = await locator.evaluate((element) => ({
    tag: element.tagName.toLowerCase(),
    type: element.getAttribute("type") || "",
  }));

  if (info.type === "checkbox" || info.type === "radio") {
    return { filled: false, reason: "unsupported_control" };
  }

  if (info.tag === "select") {
    const target = String(value);
    try {
      await locator.selectOption({ label: target }, { timeout: 4000 });
    } catch {
      try {
        await locator.selectOption(target, { timeout: 4000 });
      } catch {
        return { filled: false, reason: "option_not_found" };
      }
    }
    return { filled: true, actual: target };
  }

  await locator.fill(String(value).slice(0, MAX_TEXT_LENGTH), { timeout: 8000 });
  const actual = await locator.inputValue().catch(() => "");
  return { filled: true, actual };
}

async function collectValidationErrors(page) {
  return page.evaluate(() => {
    // Portals ship hidden template paragraphs (Lever keeps a permanent
    // "file too large" message in the DOM). Only visible nodes are errors.
    const visible = (element) =>
      Boolean(
        element.offsetWidth || element.offsetHeight || element.getClientRects().length
      );

    const nodes = Array.from(
      document.querySelectorAll(
        '[aria-invalid="true"], .error-message, .field-error, [role="alert"]'
      )
    )
      .filter(visible)
      .slice(0, 25);

    return nodes
      .map((element) => ({
        field:
          element.getAttribute("name") ||
          element.getAttribute("aria-label") ||
          "",
        message: (element.innerText || element.textContent || "").trim().slice(0, 300),
      }))
      .filter((entry) => entry.message);
  });
}

async function findFileInput(page, selectors) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector);
      if ((await locator.count()) > 0) return locator.first();
    } catch {
      // Keep looking.
    }
  }

  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 10); index += 1) {
    const candidate = inputs.nth(index);
    const hint = await candidate
      .evaluate((element) =>
        [
          element.getAttribute("name"),
          element.getAttribute("id"),
          element.getAttribute("aria-label"),
        ]
          .filter(Boolean)
          .join(" ")
      )
      .catch(() => "");
    if (/resume|cv|curriculum/i.test(hint)) return candidate;
  }

  return count > 0 ? inputs.first() : null;
}

async function scanTextareas(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("textarea"))
      .slice(0, 40)
      .map((element, index) => {
        const label =
          element.labels?.[0]?.innerText ||
          element.closest("label")?.innerText ||
          element
            .closest("fieldset")
            ?.querySelector("legend, label, .label")
            ?.textContent ||
          "";
        return {
          index,
          context: [
            label,
            element.getAttribute("aria-label"),
            element.getAttribute("name"),
            element.getAttribute("placeholder"),
            element.getAttribute("id"),
          ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300),
        };
      })
  );
}

/**
 * @param {object} args
 * @param {import("playwright").Page} args.page
 * @param {object} args.plan         Validated plan from the API.
 * @param {{format:string,path:string,fileName:string}|null} args.resumeFile
 * @param {(message:string)=>void} [args.log]
 */
export async function fillApplication({ page, plan, resumeFile, log = () => {} }) {
  const filledFields = [];
  const missingFields = [];
  const validationErrors = [];

  const signals = await pageSignals(page);
  const blockedBy = detectBlockingSignals(signals);

  if (blockedBy.length > 0) {
    log(
      `Paused: this page requires a manual step (${blockedBy.join(", ")}). The helper will not bypass it.`
    );
    return buildRunReport({
      plan,
      pageUrl: page.url(),
      blockedBy,
      botProtection: signals.botProtection,
      notes:
        "Stopped before filling because the page requires login, MFA, OTP, or a visible CAPTCHA challenge.",
    });
  }

  // React-based portals mount their form after load. Wait, bounded, for the
  // adapter's own selectors before scanning, or every field would be reported
  // missing on a page whose form simply has not rendered yet.
  const formRendered = await waitForMappedForm(page, plan);

  if (!formRendered) {
    log(
      "No mapped form field appeared within the wait window. This portal may need a manual step."
    );
    return buildRunReport({
      plan,
      pageUrl: page.url(),
      missingFields: (plan.fields || []).map((field) => ({
        canonical: field.canonical,
        label: field.label,
        reason: "form_not_found",
      })),
      botProtection: signals.botProtection,
      notes:
        "The application form did not appear in the time allowed. Nothing was typed and nothing was submitted.",
    });
  }

  for (const field of plan.fields) {
    const target = await locateField(page, field);
    if (!target) {
      missingFields.push({
        canonical: field.canonical,
        label: field.label,
        reason: "field_not_found",
      });
      continue;
    }

    try {
      const result = await fillTextControl(target.locator, field.value);
      if (!result.filled) {
        missingFields.push({
          canonical: field.canonical,
          label: field.label,
          reason: result.reason || "not_filled",
        });
        continue;
      }

      filledFields.push({
        canonical: field.canonical,
        label: field.label,
        selector: target.selector || field.label,
      });

      if (result.actual && String(result.actual).trim() !== String(field.value).trim()) {
        validationErrors.push({
          field: field.label,
          message: `The page stored a different value than the verified profile value for ${field.label}.`,
        });
      }
    } catch (error) {
      missingFields.push({
        canonical: field.canonical,
        label: field.label,
        reason: `fill_failed: ${String(error?.message || error).slice(0, 120)}`,
      });
    }
  }

  let resumeUploaded = null;
  if (resumeFile) {
    const fileInput = await findFileInput(page, plan.resume?.selectors || []);
    if (!fileInput) {
      missingFields.push({
        canonical: "resume",
        label: "Resume upload",
        reason: "file_input_not_found",
      });
    } else {
      try {
        await fileInput.setInputFiles(resumeFile.path);
        resumeUploaded = {
          format: resumeFile.format,
          fileName: resumeFile.fileName,
        };
        log(`Attached the approved ${resumeFile.format.toUpperCase()} resume.`);
      } catch (error) {
        missingFields.push({
          canonical: "resume",
          label: "Resume upload",
          reason: `upload_failed: ${String(error?.message || error).slice(0, 120)}`,
        });
      }
    }
  } else {
    missingFields.push({
      canonical: "resume",
      label: "Resume upload",
      reason: "no_approved_file_supplied",
    });
  }

  let coverLetterFilled = false;
  if (plan.coverLetter?.body) {
    const target = await firstVisible(page, plan.coverLetter.selectors || []);
    const fallback = target ? null : await labeledFallback(page, "Cover letter");
    const locator = target?.locator || fallback;
    if (!locator) {
      missingFields.push({
        canonical: "coverLetter",
        label: "Cover letter",
        reason: "textarea_not_found",
      });
    } else {
      try {
        await fillTextControl(locator, plan.coverLetter.body);
        coverLetterFilled = true;
      } catch {
        missingFields.push({
          canonical: "coverLetter",
          label: "Cover letter",
          reason: "fill_failed",
        });
      }
    }
  }

  const textareas = await scanTextareas(page);
  const answersFilled = [];
  const answersNotFilled = [];
  const usedIndexes = new Set();

  for (const answer of plan.answers || []) {
    let matched = null;
    for (const textarea of textareas) {
      if (usedIndexes.has(textarea.index)) continue;
      if (matchAnswerForQuestion(textarea.context, [answer])) {
        matched = textarea;
        break;
      }
    }

    if (!matched) {
      answersNotFilled.push(answer.question);
      continue;
    }

    try {
      await page
        .locator("textarea")
        .nth(matched.index)
        .fill(String(answer.answer).slice(0, MAX_TEXT_LENGTH), { timeout: 8000 });
      usedIndexes.add(matched.index);
      answersFilled.push(answer.question);
    } catch {
      answersNotFilled.push(answer.question);
    }
  }

  const unsupportedControls = await scanUnsupported(page);
  const controls = await scanControls(page);
  const { submissionControls } = partitionControls(controls);

  await page.waitForTimeout(300);
  validationErrors.push(...(await collectValidationErrors(page)));

  log(
    `Filled ${filledFields.length} fields, attached ${
      resumeUploaded ? "1 resume" : "no resume"
    }, filled ${answersFilled.length} saved answers. Left ${submissionControls.length} final submission control(s) untouched.`
  );

  const botProtectionNote =
    signals.botProtection.detected && !signals.botProtection.visibleChallenge
      ? " Invisible bot-protection scripts were present; they were not touched."
      : "";

  return buildRunReport({
    plan,
    pageUrl: page.url(),
    filledFields,
    missingFields,
    validationErrors,
    unsupportedControls,
    resumeUploaded,
    coverLetterFilled,
    answersFilled,
    answersNotFilled,
    finalSubmissionControls: submissionControls.map(
      (control) => control.label || control.ariaLabel || "unlabeled control"
    ),
    botProtection: signals.botProtection,
    notes: `The browser was left open for review. No submission control was clicked.${botProtectionNote}`,
  });
}
