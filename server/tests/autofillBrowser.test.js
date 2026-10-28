/**
 * Live browser test for the local helper.
 *
 * A Greenhouse-shaped form is served from loopback. The helper must fill it,
 * attach the approved PDF, and leave the Submit application control untouched.
 * The test skips itself with a clear message when the optional Playwright
 * dependency is not installed.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchSession } from "../../tools/autofill/lib/session.js";
import { SAFETY_POLICY } from "../src/services/autofill/safety.js";
import { PlanError, validatePlanSafety } from "../../tools/autofill/lib/plan.js";

const APPLICATION_PAGE = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Frontend Engineering Intern</title></head>
  <body>
    <h1>Frontend Engineering Intern</h1>
    <form id="application-form" action="/apply" method="post">
      <label for="first_name">First name</label>
      <input id="first_name" name="job_application[first_name]" />

      <label for="last_name">Last name</label>
      <input id="last_name" name="job_application[last_name]" />

      <label for="email">Email</label>
      <input id="email" name="job_application[email]" type="email" />

      <label for="phone">Phone</label>
      <input id="phone" name="job_application[phone]" type="tel" />

      <label for="location">Location</label>
      <input id="location" name="job_application[location]" />

      <label for="school">School</label>
      <input id="school" name="job_application[school]" />

      <label for="resume">Resume</label>
      <input id="resume" name="job_application[resume]" type="file" />

      <label for="cover_letter">Cover letter</label>
      <textarea id="cover_letter" name="job_application[cover_letter]"></textarea>

      <label for="why_role">Why do you want this role?</label>
      <textarea id="why_role" name="job_application[why_role]"></textarea>

      <button type="button">Save draft</button>
      <button
        type="submit"
        id="submit-application"
        onclick="window.__clickedSubmit = true"
      >
        Submit application
      </button>
    </form>
    <script>
      window.__submitted = 0;
      window.__clickedSubmit = false;
      document.getElementById("application-form").addEventListener("submit", (event) => {
        window.__submitted += 1;
        event.preventDefault();
      });
    </script>
  </body>
</html>`;

const LOGIN_PAGE = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Sign in to apply</title></head>
  <body>
    <h1>Sign in to apply</h1>
    <label for="password">Password</label>
    <input id="password" type="password" name="password" />
    <button type="submit">Submit application</button>
  </body>
</html>`;

// Mirrors the React portals seen in the audit: the form mounts ~2s after load,
// and a hidden error paragraph ships in the initial markup.
const SLOW_APPLICATION_PAGE = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Slow portal</title></head>
  <body>
    <h1>Slow portal</h1>
    <style>.error-message { display: none; }</style>
    <p class="error-message">File exceeds the maximum upload size of 100MB.</p>
    <div id="form-root"></div>
    <script>
      setTimeout(function () {
        document.getElementById("form-root").innerHTML =
          '<form id="application-form">' +
          '<label for="first_name">First name</label>' +
          '<input id="first_name" name="_systemfield_name" />' +
          '<label for="email">Email</label>' +
          '<input id="email" name="_systemfield_email" type="email" />' +
          '<label for="resume">Resume</label>' +
          '<input id="resume" type="file" />' +
          '<button type="submit">Submit Application</button>' +
          '</form>';
        window.__submitted = 0;
        document.getElementById("application-form").addEventListener("submit", function (event) {
          window.__submitted += 1;
          event.preventDefault();
        });
      }, 1200);
    </script>
  </body>
</html>`;

let server;
let baseUrl;
let workspace;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");

    if (url.pathname === "/login") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(LOGIN_PAGE);
      return;
    }

    if (url.pathname === "/apply") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(APPLICATION_PAGE);
      return;
    }

    if (url.pathname === "/slow") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(SLOW_APPLICATION_PAGE);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  workspace = await mkdtemp(path.join(tmpdir(), "autofill-browser-test-"));
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

function buildPlan(overrides = {}) {
  return {
    schemaVersion: 1,
    canAutofill: true,
    blockers: [],
    adapter: {
      key: "greenhouse",
      name: "Greenhouse",
      supported: true,
      autofillSupported: true,
      resumeUploadSupported: true,
    },
    job: { applicationUrl: `${baseUrl}/apply` },
    fields: [
      {
        canonical: "firstName",
        label: "First name",
        value: "Meera",
        selectors: ["#first_name", 'input[name="job_application[first_name]"]'],
      },
      {
        canonical: "lastName",
        label: "Last name",
        value: "Nair",
        selectors: ["#last_name"],
      },
      {
        canonical: "email",
        label: "Email",
        value: "meera@example.com",
        selectors: ["#email"],
      },
      {
        canonical: "phone",
        label: "Phone",
        value: "+91 90000 00000",
        selectors: ["#phone"],
      },
      {
        canonical: "location",
        label: "Location",
        value: "Pune, India",
        selectors: ["#location"],
      },
      {
        canonical: "latestSchool",
        label: "School",
        value: "Example University",
        selectors: ['input[name*="school" i]'],
      },
    ],
    missingFields: [],
    resume: {
      tailoredResumeId: "tr-1",
      revision: 1,
      files: [
        { format: "pdf", fileName: "meera-tailored.pdf" },
        { format: "docx", fileName: "meera-tailored.docx" },
      ],
      selectors: ['input[type="file"][name="job_application[resume]"]'],
    },
    coverLetter: {
      subject: "Frontend Engineering Intern",
      body: "I build accessible React dashboards and would like to build them here.",
      selectors: ['textarea[name="job_application[cover_letter]"]'],
    },
    answers: [
      {
        question: "Why do you want this role?",
        answer: "Because the dashboard work matches what I already ship.",
        approvedAt: "2026-10-01T00:00:00.000Z",
      },
    ],
    projects: [],
    education: [],
    experience: [],
    safety: { ...SAFETY_POLICY },
    manualFallback: {
      instructions: [
        "Open the employer's application page.",
        "Paste values yourself.",
        "Submit yourself.",
      ],
    },
    ...overrides,
  };
}

test("the helper fills a supported form and never clicks the submission control", async (t) => {
  const pdfPath = path.join(workspace, "meera-tailored.pdf");
  await writeFile(pdfPath, Buffer.from("%PDF-1.4\n% test resume\n%%EOF\n"));

  let session;
  try {
    session = await launchSession({
      plan: buildPlan(),
      resumeFile: { format: "pdf", path: pdfPath, fileName: "meera-tailored.pdf" },
      url: `${baseUrl}/apply`,
      headless: true,
      profileDir: path.join(workspace, "profile"),
      log: () => {},
    });
  } catch (error) {
    if (
      error?.code === "ERR_MODULE_NOT_FOUND" ||
      /Executable doesn't exist|browserType\.launch/i.test(error?.message || "")
    ) {
      t.skip(
        "Playwright is not installed. Run `cd tools/autofill && npm install && npx playwright install chromium` to enable this live test."
      );
      return;
    }
    throw error;
  }

  const { context, page, report } = session;

  try {
    assert.equal(report.status, "prepared");
    assert.equal(report.submitted, false);
    assert.deepEqual(report.blockedBy, []);
    assert.equal(report.resumeUploaded.format, "pdf");
    assert.equal(report.resumeUploaded.fileName, "meera-tailored.pdf");
    assert.equal(report.coverLetterFilled, true);
    assert.deepEqual(report.answersFilled, ["Why do you want this role?"]);

    const filled = report.filledFields.map((entry) => entry.canonical).sort();
    assert.deepEqual(filled, [
      "email",
      "firstName",
      "lastName",
      "latestSchool",
      "location",
      "phone",
    ]);

    assert.deepEqual(report.missingFields, []);
    assert.deepEqual(report.validationErrors, []);
    assert.ok(
      report.finalSubmissionControls.some((label) =>
        /submit application/i.test(label)
      ),
      "the submit control should be reported, not touched"
    );

    assert.equal(await page.inputValue("#first_name"), "Meera");
    assert.equal(await page.inputValue("#email"), "meera@example.com");
    assert.equal(await page.inputValue("#location"), "Pune, India");
    assert.equal(await page.inputValue("#school"), "Example University");
    assert.equal(await page.inputValue("#phone"), "+91 90000 00000");
    assert.match(
      await page.inputValue("#cover_letter"),
      /accessible React dashboards/
    );
    assert.match(await page.inputValue("#why_role"), /dashboard work/);

    const uploaded = await page.locator("#resume").evaluate((element) => {
      return element.files?.length || 0;
    });
    assert.equal(uploaded, 1);

    // The page stayed on the application form and nothing was submitted.
    assert.match(page.url(), /\/apply$/);
    const submitted = await page.evaluate(() => ({
      count: window.__submitted,
      clicked: window.__clickedSubmit,
    }));
    assert.equal(submitted.count, 0);
    assert.equal(submitted.clicked, false);
    assert.equal(await page.locator("#submit-application").isEnabled(), true);
  } finally {
    await context.close().catch(() => {});
  }
});

test("the helper refuses to fill a login-protected page", async (t) => {
  let session;
  try {
    session = await launchSession({
      plan: buildPlan({ job: { applicationUrl: `${baseUrl}/login` } }),
      resumeFile: null,
      url: `${baseUrl}/login`,
      headless: true,
      profileDir: path.join(workspace, "profile-login"),
      log: () => {},
    });
  } catch (error) {
    if (
      error?.code === "ERR_MODULE_NOT_FOUND" ||
      /Executable doesn't exist|browserType\.launch/i.test(error?.message || "")
    ) {
      t.skip("Playwright is not installed; live browser checks are skipped.");
      return;
    }
    throw error;
  }

  const { context, page, report } = session;

  try {
    assert.equal(report.status, "failed");
    assert.deepEqual(report.blockedBy, ["login"]);
    assert.equal(report.filledFields.length, 0);
    assert.equal(report.resumeUploaded, null);
    assert.match(report.notes, /requires login|MFA|CAPTCHA/i);

    // The password field is untouched and the page is still on the login step.
    assert.equal(await page.inputValue("#password"), "");
    assert.match(page.url(), /\/login$/);
    const submitted = await page.evaluate(() => window.__submitted || 0);
    assert.equal(submitted, 0);
  } finally {
    await context.close().catch(() => {});
  }
});

test("the helper waits for a delayed form and ignores hidden template errors", async (t) => {
  const pdfPath = path.join(workspace, "slow-resume.pdf");
  await writeFile(pdfPath, Buffer.from("%PDF-1.4\n% slow fixture\n%%EOF\n"));

  // Ashby mounts its form ~2s after load; the plan below only exposes fields
  // the delayed form actually renders, so the wait can find them.
  const slowPlan = buildPlan({
    fields: [
      {
        canonical: "firstName",
        label: "First name",
        value: "Meera",
        selectors: ['input[name="_systemfield_name"]', "#first_name"],
      },
      {
        canonical: "email",
        label: "Email",
        value: "meera@example.com",
        selectors: ['input[name="_systemfield_email"]', "#email"],
      },
    ],
    resume: {
      tailoredResumeId: "tr-1",
      revision: 1,
      files: [{ format: "pdf", fileName: "slow-resume.pdf" }],
      selectors: ['input[type="file"]', "#resume"],
    },
    coverLetter: null,
    answers: [],
  });

  let session;
  try {
    session = await launchSession({
      plan: slowPlan,
      resumeFile: { format: "pdf", path: pdfPath, fileName: "slow-resume.pdf" },
      url: `${baseUrl}/slow`,
      headless: true,
      profileDir: path.join(workspace, "profile-slow"),
      log: () => {},
    });
  } catch (error) {
    if (
      error?.code === "ERR_MODULE_NOT_FOUND" ||
      /Executable doesn\'t exist|browserType\.launch/i.test(error?.message || "")
    ) {
      t.skip("Playwright is not installed; live browser checks are skipped.");
      return;
    }
    throw error;
  }

  const { context, page, report } = session;

  try {
    // The wait must have found the mounted form rather than reporting a miss.
    assert.equal(report.status, "prepared");
    assert.deepEqual(
      report.filledFields.map((entry) => entry.canonical).sort(),
      ["email", "firstName"]
    );
    assert.deepEqual(report.missingFields, []);
    assert.equal(report.resumeUploaded.format, "pdf");
    assert.equal(await page.inputValue("#first_name"), "Meera");

    // The hidden template error paragraph ships in the initial markup and must
    // never be surfaced as a real validation error.
    assert.deepEqual(report.validationErrors, []);

    assert.ok(
      report.finalSubmissionControls.some((label) =>
        /submit application/i.test(label)
      )
    );
    assert.equal(report.submitted, false);
    assert.equal(await page.evaluate(() => window.__submitted || 0), 0);
  } finally {
    await context.close().catch(() => {});
  }
});

test("an unsafe plan is rejected before any browser is launched", () => {
  assert.throws(
    () =>
      validatePlanSafety(
        buildPlan({ safety: { ...SAFETY_POLICY, autoSubmit: true } })
      ),
    (error) => error instanceof PlanError && error.code === "SAFETY_POLICY_MISSING"
  );

  assert.throws(
    () => validatePlanSafety(buildPlan({ canAutofill: false, blockers: [] })),
    (error) => error.code === "PLAN_BLOCKED"
  );
});
