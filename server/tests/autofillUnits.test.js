import test from "node:test";
import assert from "node:assert/strict";

import {
  SAFETY_POLICY,
  SubmitGuardError,
  assertNotFinalSubmission,
  classifyControl,
  isFinalSubmissionControl,
  partitionControls,
} from "../src/services/autofill/safety.js";
import {
  adapterSummary,
  applicationFormUrl,
  detectAdapter,
  listAdapters,
} from "../src/services/autofill/adapters.js";
import {
  buildAutofillPlan,
  buildFieldValues,
  buildProjectSnapshot,
} from "../src/services/autofill/plan.js";
import {
  evaluateReadiness,
  matchApprovedAnswer,
  normalizeRequirements,
  screeningAnswerGaps,
} from "../src/services/readiness.js";
import {
  PlanError,
  buildRunReport,
  selectResumeFile,
  selectorsFor,
  validatePlanSafety,
} from "../../tools/autofill/lib/plan.js";
import {
  classifyUnsupportedControls,
  detectBlockingSignals,
} from "../../tools/autofill/lib/detect.js";

const profile = {
  headline: "Frontend Engineering Intern",
  summary: "React developer focused on accessible dashboards.",
  phone: "+91 90000 00000",
  location: "Pune, India",
  linkedinUrl: "https://linkedin.com/in/meera",
  githubUrl: "https://github.com/meera",
  portfolioUrl: "",
  skills: ["JavaScript", "React", "Node.js"],
  education: [
    {
      institution: "Example University",
      degree: "B.Tech",
      field: "Information Technology",
      endYear: 2027,
    },
  ],
  experience: [
    {
      company: "Campus Labs",
      title: "Frontend Intern",
      startDate: "2025",
      current: true,
      description: "Built dashboards.",
    },
  ],
  projects: [
    {
      name: "Campus Queue Service",
      description: "Queueing for lab equipment.",
      technologies: ["React", "Node.js"],
      accomplishments: [
        { text: "Cut average wait time by 35%", verified: true },
        { text: "Handled 1,200 requests per day", verified: false },
      ],
    },
  ],
  answerBank: [
    {
      question: "Why do you want this role?",
      answer: "The React scope matches what I already build.",
      approved: true,
      approvedAt: new Date("2026-10-01T00:00:00.000Z"),
    },
    {
      question: "What are your salary expectations?",
      answer: "Happy to discuss later.",
      approved: false,
    },
  ],
  workAuthorization: { status: "work_visa", requiresSponsorship: true },
};

function makeUser(overrides = {}, profileOverrides = {}) {
  return {
    name: "Meera Nair",
    email: "meera@example.com",
    ...overrides,
    profile: { ...profile, ...profileOverrides },
  };
}

const job = {
  _id: "65f000000000000000000001",
  title: "Frontend Engineering Intern",
  company: "Acme Systems",
  applicationUrl: "https://boards.greenhouse.io/acmesystems/jobs/4001",
  skills: ["React", "Node.js"],
};

const application = {
  _id: "65f000000000000000000002",
  status: "planned",
  coverLetter: {
    subject: "Frontend Engineering Intern",
    body: "I build React dashboards and would like to build them here.",
  },
};

const approvedResume = {
  _id: "65f000000000000000000003",
  revision: 2,
  approvedAt: new Date("2026-10-20T00:00:00.000Z"),
  content: {
    summary: "Tailored for Frontend Engineering Intern at Acme Systems.",
    skills: ["React", "Node.js"],
  },
  files: [
    {
      format: "pdf",
      fileName: "meera-tailored.pdf",
      mimeType: "application/pdf",
      size: 2048,
      checksum: "a".repeat(64),
    },
    {
      format: "docx",
      fileName: "meera-tailored.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 4096,
      checksum: "b".repeat(64),
    },
  ],
};

test("submit guard blocks every final submission control and allows ordinary controls", () => {
  for (const control of [
    { text: "Submit application", tag: "button" },
    { text: "Submit", tag: "button", type: "submit" },
    { text: "Apply", tag: "button" },
    { text: "Apply now", tag: "a", role: "button" },
    { text: "Send application", tag: "button" },
    { text: "", tag: "input", type: "submit" },
    { ariaLabel: "Submit your application", tag: "button" },
  ]) {
    assert.equal(
      isFinalSubmissionControl(control),
      true,
      `expected to block ${JSON.stringify(control)}`
    );
  }

  for (const control of [
    { text: "Save draft", tag: "button" },
    { text: "Upload resume", tag: "button" },
    { text: "Next", tag: "button" },
    { text: "Preview application", tag: "button" },
    { text: "Apply filters", tag: "button" },
    { text: "Add another education entry", tag: "button" },
  ]) {
    assert.equal(
      isFinalSubmissionControl(control),
      false,
      `expected to allow ${JSON.stringify(control)}`
    );
  }

  assert.throws(
    () => assertNotFinalSubmission({ text: "Submit application", tag: "button" }),
    (error) =>
      error instanceof SubmitGuardError &&
      error.code === "SUBMIT_GUARD_BLOCKED" &&
      /submit the application yourself/i.test(error.message)
  );

  const { submissionControls, otherControls } = partitionControls([
    { text: "Upload resume", tag: "button" },
    { text: "Submit application", tag: "button" },
    { text: "Save draft", tag: "button" },
  ]);

  assert.equal(submissionControls.length, 1);
  assert.equal(submissionControls[0].label, "Submit application");
  assert.equal(otherControls.length, 2);

  assert.equal(SAFETY_POLICY.autoSubmit, false);
  assert.equal(SAFETY_POLICY.clicksAllowed, false);
  assert.ok(
    SAFETY_POLICY.forbiddenActions.some((entry) => /CAPTCHA/i.test(entry))
  );
  assert.equal(classifyControl({ text: "Submit" }).reason, "submission_label");
});

test("adapter detection is host-based and marks restricted portals as unsupported", () => {
  const cases = [
    ["https://boards.greenhouse.io/acme/jobs/1", "greenhouse", true],
    ["https://job-boards.greenhouse.io/acme/jobs/1", "greenhouse", true],
    ["https://jobs.lever.co/acme/1234", "lever", true],
    ["https://jobs.ashbyhq.com/acme/1234", "ashby", true],
    ["https://www.linkedin.com/jobs/view/1", "linkedin", false],
    ["https://acme.wd1.myworkdayjobs.com/en-US/job/1", "workday", false],
    ["https://careers.example.com/apply/42", "generic", false],
  ];

  for (const [url, key, supported] of cases) {
    const adapter = detectAdapter(url);
    assert.equal(adapter.key, key, url);
    assert.equal(adapter.supported, supported, url);
  }

  assert.equal(detectAdapter("not a url").key, "generic");
  assert.equal(detectAdapter("file:///etc/passwd").supported, false);

  const keys = listAdapters().map((adapter) => adapter.key);
  for (const key of ["greenhouse", "lever", "ashby", "linkedin", "workday", "generic"]) {
    assert.ok(keys.includes(key), `missing ${key}`);
  }

  const workday = adapterSummary(detectAdapter("https://acme.myworkdayjobs.com/job/1"));
  assert.equal(workday.supported, false);
  assert.match(workday.unsupportedReason, /account/i);

  const greenhouse = adapterSummary(
    detectAdapter("https://boards.greenhouse.io/acme/jobs/1")
  );
  assert.equal(greenhouse.autofillSupported, true);
  assert.equal(greenhouse.matchedHost, "boards.greenhouse.io");

  // Ashby renders a separate "Autofill from resume" file input above the real
  // resume field; the system field must be selected first.
  const ashby = detectAdapter("https://jobs.ashbyhq.com/acme/1234");
  assert.equal(ashby.resumeSelectors[0], 'input[type="file"][id="_systemfield_resume"]');
  assert.equal(ashby.resumeSelectors.at(-1), 'input[type="file"]');
});

test("listing URLs are resolved to the public application form", () => {
  assert.equal(
    applicationFormUrl("https://jobs.lever.co/acme/1234"),
    "https://jobs.lever.co/acme/1234/apply"
  );
  assert.equal(
    applicationFormUrl("https://jobs.lever.co/acme/1234/apply"),
    "https://jobs.lever.co/acme/1234/apply"
  );
  assert.equal(
    applicationFormUrl("https://jobs.ashbyhq.com/acme/1234"),
    "https://jobs.ashbyhq.com/acme/1234/application"
  );
  assert.equal(
    applicationFormUrl("https://jobs.ashbyhq.com/acme/1234/application"),
    "https://jobs.ashbyhq.com/acme/1234/application"
  );
  assert.equal(
    applicationFormUrl("https://job-boards.greenhouse.io/acme/jobs/1"),
    "https://job-boards.greenhouse.io/acme/jobs/1"
  );
  assert.equal(applicationFormUrl("not a url"), "not a url");

  const leverJob = { ...job, applicationUrl: "https://jobs.lever.co/acme/1234" };
  const leverPlan = buildAutofillPlan({
    user: makeUser(),
    job: leverJob,
    application,
    approvedResume,
    adapter: detectAdapter(leverJob.applicationUrl),
  });
  assert.equal(
    leverPlan.job.applicationUrl,
    "https://jobs.lever.co/acme/1234/apply"
  );
  assert.equal(leverPlan.job.listingUrl, "https://jobs.lever.co/acme/1234");
  assert.equal(leverPlan.job.applicationUrlAdjusted, true);

  const ashbyFields = detectAdapter(
    "https://jobs.ashbyhq.com/acme/1234"
  ).fields;
  const linkedin = ashbyFields.find((field) => field.canonical === "linkedinUrl");
  assert.ok(linkedin.labels.includes("LinkedIn Profile"));
});

test("autofill plans use verified profile values and the approved revision only", () => {
  const { values, sources } = buildFieldValues({
    user: makeUser(),
    approvedResume,
  });

  assert.equal(values.firstName, "Meera");
  assert.equal(values.lastName, "Nair");
  assert.equal(values.email, "meera@example.com");
  assert.equal(values.latestSchool, "Example University");
  assert.equal(values.latestGraduationYear, "2027");
  assert.equal(values.skills, "React, Node.js");
  assert.equal(sources.summary, "approved_tailored_resume");
  // Draft content is never passed in, so the profile summary is the fallback.
  assert.match(values.summary, /Tailored for Frontend Engineering Intern/);

  const withoutApproval = buildFieldValues({ user: makeUser(), approvedResume: null });
  assert.equal(withoutApproval.values.skills, "JavaScript, React, Node.js");
  assert.equal(withoutApproval.sources.summary, "profile");

  const projects = buildProjectSnapshot(profile);
  assert.deepEqual(projects[0].accomplishments, ["Cut average wait time by 35%"]);

  const plan = buildAutofillPlan({
    user: makeUser(),
    job,
    application,
    approvedResume,
    adapter: detectAdapter(job.applicationUrl),
  });

  assert.equal(plan.canAutofill, true);
  assert.equal(plan.safety.autoSubmit, false);
  assert.equal(plan.safety.finalSubmissionRequiresHuman, true);
  assert.equal(plan.resume.files.length, 2);
  assert.equal(plan.answers.length, 1);
  assert.equal(plan.answers[0].question, "Why do you want this role?");
  assert.ok(plan.coverLetter.body.length > 10);
  assert.deepEqual(plan.projects[0].accomplishments, [
    "Cut average wait time by 35%",
  ]);
  assert.ok(!JSON.stringify(plan).includes("1,200 requests"));

  const missingResume = buildAutofillPlan({
    user: makeUser(),
    job,
    application,
    approvedResume: null,
    adapter: detectAdapter(job.applicationUrl),
  });
  assert.equal(missingResume.canAutofill, false);
  assert.ok(missingResume.blockers.some((entry) => entry.code === "no_approved_resume"));
  assert.equal(missingResume.resume, null);

  const unsupported = buildAutofillPlan({
    user: makeUser(),
    job: { ...job, applicationUrl: "https://www.linkedin.com/jobs/view/1" },
    application,
    approvedResume,
    adapter: detectAdapter("https://www.linkedin.com/jobs/view/1"),
  });
  assert.equal(unsupported.canAutofill, false);
  assert.deepEqual(unsupported.fields, []);
  assert.equal(unsupported.blockers[0].code, "unsupported_portal");
  assert.ok(unsupported.manualFallback.instructions.length >= 3);

  const submitted = buildAutofillPlan({
    user: makeUser(),
    job,
    application: { ...application, status: "submitted" },
    approvedResume,
    adapter: detectAdapter(job.applicationUrl),
  });
  assert.ok(submitted.blockers.some((entry) => entry.code === "already_submitted"));

  const missingPhone = buildFieldValues({
    user: makeUser({}, { phone: "" }),
    approvedResume,
  });
  assert.equal(missingPhone.values.phone, "");
});

test("readiness reports blocking gaps, warnings, and preserves application status", () => {
  const ready = evaluateReadiness({
    user: makeUser(),
    job,
    application,
    approvedResume,
    latestDraft: null,
    adapter: detectAdapter(job.applicationUrl),
  });

  assert.equal(ready.ready, true);
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.blocking, []);
  assert.equal(ready.applicationStatus, "planned");
  assert.equal(ready.statusPreserved, true);
  assert.equal(ready.approvedResume.revision, 2);
  assert.equal(ready.checks.find((entry) => entry.id === "final_submission_guard").status, "pass");
  assert.equal(ready.submission.automatic, false);

  const noResume = evaluateReadiness({
    user: makeUser(),
    job,
    application,
    approvedResume: null,
    latestDraft: { revision: 3 },
    adapter: detectAdapter(job.applicationUrl),
  });
  assert.equal(noResume.ready, false);
  assert.ok(noResume.blocking.includes("approved_resume"));
  assert.match(
    noResume.checks.find((entry) => entry.id === "approved_resume").detail,
    /revision 3 is still a draft/i
  );

  const noPhone = evaluateReadiness({
    user: makeUser({}, { phone: "" }),
    job,
    application,
    approvedResume,
    adapter: detectAdapter(job.applicationUrl),
  });
  const contact = noPhone.checks.find((entry) => entry.id === "contact_details");
  assert.equal(contact.status, "warn");
  assert.equal(noPhone.ready, true);
  assert.ok(noPhone.missingProfile.some((entry) => entry.field === "phone"));

  const required = evaluateReadiness({
    user: makeUser(),
    job,
    application: { ...application, coverLetter: {} },
    approvedResume,
    adapter: detectAdapter(job.applicationUrl),
    requirements: {
      coverLetter: "required",
      questions: [
        "Why do you want this role?",
        "Describe a production API you built.",
      ],
    },
  });

  assert.equal(required.ready, false);
  assert.ok(required.blocking.includes("cover_letter"));
  assert.ok(required.blocking.includes("screening_answers"));
  assert.deepEqual(required.missingAnswers, [
    {
      question: "Describe a production API you built.",
      reason: "no_approved_answer",
    },
  ]);

  assert.deepEqual(normalizeRequirements({ coverLetter: "nonsense" }), {
    coverLetter: "recommended",
    questions: [],
  });
  assert.equal(normalizeRequirements({ questions: ["  ", "A question?"] }).questions.length, 1);

  assert.equal(
    matchApprovedAnswer(
      "Why do you want this role?",
      profile.answerBank.filter((entry) => !entry.approved)
    ),
    null,
    "unapproved answers never match once the caller filters them out"
  );
  const approvedOnly = profile.answerBank.filter((entry) => entry.approved);
  assert.equal(
    matchApprovedAnswer("why do you want this role", approvedOnly).answer.question,
    "Why do you want this role?"
  );
  assert.equal(matchApprovedAnswer("Describe a Kubernetes migration", approvedOnly), null);
  assert.deepEqual(
    screeningAnswerGaps(profile, ["Why do you want this role?", "Tell me about Go"]),
    [{ question: "Tell me about Go", reason: "no_approved_answer" }]
  );
});

test("helper refuses unsafe plans and always reports submitted:false", () => {
  const safePlan = buildAutofillPlan({
    user: makeUser(),
    job,
    application,
    approvedResume,
    adapter: detectAdapter(job.applicationUrl),
  });

  assert.equal(validatePlanSafety(safePlan), safePlan);

  assert.throws(
    () =>
      validatePlanSafety({
        ...safePlan,
        safety: { ...safePlan.safety, autoSubmit: true },
      }),
    (error) => error instanceof PlanError && error.code === "SAFETY_POLICY_MISSING"
  );

  assert.throws(
    () =>
      validatePlanSafety({
        ...safePlan,
        safety: { ...safePlan.safety, finalSubmissionRequiresHuman: false },
      }),
    (error) => error.code === "SAFETY_POLICY_MISSING"
  );

  assert.throws(
    () =>
      validatePlanSafety({
        ...safePlan,
        canAutofill: false,
        blockers: [{ code: "unsupported_portal", detail: "No adapter." }],
      }),
    (error) => error.code === "PLAN_BLOCKED" && /No adapter/.test(error.message)
  );

  assert.throws(() => validatePlanSafety({ schemaVersion: 99 }), PlanError);

  const pdf = selectResumeFile(safePlan, {
    pdf: "/tmp/resume.pdf",
    docx: "/tmp/resume.docx",
  });
  assert.equal(pdf.format, "pdf");
  assert.equal(pdf.path, "/tmp/resume.pdf");

  const docx = selectResumeFile(
    { ...safePlan, resume: { ...safePlan.resume, files: [{ format: "docx" }] } },
    { pdf: "/tmp/resume.pdf", docx: "/tmp/resume.docx" }
  );
  assert.equal(docx.format, "docx");
  assert.equal(selectResumeFile(safePlan, {}), null);
  assert.deepEqual(selectorsFor({ selectors: ["#a", "", null] }), ["#a"]);

  const prepared = buildRunReport({
    plan: safePlan,
    pageUrl: "https://boards.greenhouse.io/acme/jobs/1",
    filledFields: [{ canonical: "firstName", label: "First name" }],
    resumeUploaded: { format: "pdf", fileName: "resume.pdf" },
    answersFilled: ["Why do you want this role?"],
  });
  assert.equal(prepared.status, "prepared");
  assert.equal(prepared.submitted, false);
  assert.deepEqual(prepared.botProtection, {
    detected: false,
    visibleChallenge: false,
    kinds: [],
  });

  const review = buildRunReport({
    plan: safePlan,
    missingFields: [{ canonical: "lastName", label: "Last name" }],
    answersNotFilled: ["Describe a production API you built."],
  });
  assert.equal(review.status, "needs_review");
  assert.equal(review.submitted, false);
  assert.ok(
    review.missingFields.some((entry) => entry.canonical === "answer")
  );

  const failed = buildRunReport({
    plan: safePlan,
    blockedBy: ["captcha"],
  });
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.blockedBy, ["captcha"]);
});

test("blocking signal detection stops before login, CAPTCHA, or OTP", () => {
  assert.deepEqual(detectBlockingSignals({}), []);
  assert.deepEqual(
    detectBlockingSignals({
      frameSources: ["https://www.google.com/recaptcha/api2/anchor"],
    }),
    ["captcha"]
  );
  assert.deepEqual(
    detectBlockingSignals({ hasVisibleCaptcha: true }),
    ["captcha"]
  );
  assert.deepEqual(
    detectBlockingSignals({
      pageText: "Please verify you are human to continue",
    }),
    ["captcha"]
  );
  // Invisible enterprise scripts and their badges are not a challenge. The
  // helper reports them but does not refuse to fill a public form.
  assert.deepEqual(
    detectBlockingSignals({
      pageText: "This site is protected by reCAPTCHA and the Google Privacy Policy.",
    }),
    []
  );
  assert.deepEqual(
    detectBlockingSignals({ hasPasswordInput: true }),
    ["login"]
  );
  assert.deepEqual(
    detectBlockingSignals({ hasOtpInput: true }),
    ["otp"]
  );
  assert.deepEqual(
    detectBlockingSignals({ pageText: "Please log in to apply" }),
    ["login"]
  );

  const unsupported = classifyUnsupportedControls([
    { tag: "input", type: "text", label: "First name" },
    { tag: "select", type: "select-one", label: "Degree" },
    { tag: "div", contentEditable: true, label: "Why this role" },
    { tag: "input", type: "range", label: "Salary slider" },
    { role: "combobox", label: "Custom dropdown" },
    { tag: "input", type: "file", label: "Resume" },
  ]);

  assert.ok(unsupported.some((entry) => /Rich-text editor/.test(entry)));
  assert.ok(unsupported.some((entry) => /range/.test(entry)));
  assert.ok(unsupported.some((entry) => /Custom dropdown/.test(entry)));
  assert.ok(!unsupported.some((entry) => /First name/.test(entry)));
  assert.ok(!unsupported.some((entry) => /Degree/.test(entry)));
  assert.ok(!unsupported.some((entry) => /Resume/.test(entry)));
});
