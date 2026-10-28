import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import PDFDocument from "pdfkit";

process.env.NODE_ENV = "test";
process.env.PORT = "0";
process.env.JWT_SECRET = "autofill-integration-secret-with-enough-length-123";
process.env.MONGOMS_VERSION = "7.0.14";

const mongoServer = await MongoMemoryServer.create();
process.env.MONGO_URI = mongoServer.getUri("autofill_test");

const { default: app } = await import("../src/app.js");
const { connectDB, disconnectDB } = await import("../src/config/db.js");
const { User } = await import("../src/models/User.js");
const { Job } = await import("../src/models/Job.js");
const { Resume } = await import("../src/models/Resume.js");
const { Application } = await import("../src/models/Application.js");
const { TailoredResume } = await import("../src/models/TailoredResume.js");
const { AutofillRun } = await import("../src/models/AutofillRun.js");

let token;
let otherToken;
let jobId;
let applicationId;
let tailoredResumeId;
let linkedinApplicationId;

function makePdf(text) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(12).text(text, { lineGap: 4 });
    doc.end();
  });
}

function auth(requestBuilder, bearer = token) {
  return requestBuilder.set("Authorization", `Bearer ${bearer}`);
}

before(async () => {
  await connectDB();
  await Promise.all([
    User.init(),
    Job.init(),
    Resume.init(),
    Application.init(),
    TailoredResume.init(),
    AutofillRun.init(),
  ]);
});

after(async () => {
  await disconnectDB();
  await mongoServer.stop();
});

test("readiness requires an approved, job-specific resume", async () => {
  const registration = await request(app).post("/api/auth/register").send({
    name: "Meera Nair",
    email: "meera.autofill@example.com",
    password: "StrongPass123",
  });
  assert.equal(registration.status, 201);
  token = registration.body.data.token;

  const other = await request(app).post("/api/auth/register").send({
    name: "Dev Outsider",
    email: "dev.outsider@example.com",
    password: "StrongPass123",
  });
  assert.equal(other.status, 201);
  otherToken = other.body.data.token;

  const profile = await auth(
    request(app).patch("/api/users/me"),
    token
  ).send({
    profile: {
      headline: "Frontend Engineering Intern",
      summary: "React developer who ships dashboards backed by Node.js APIs.",
      phone: "+91 90000 00000",
      location: "Pune, India",
      skills: ["JavaScript", "React", "Node.js"],
      education: [
        {
          institution: "Example University",
          degree: "B.Tech",
          field: "Information Technology",
          startYear: 2023,
          endYear: 2027,
        },
      ],
      experience: [
        {
          company: "Campus Labs",
          title: "Frontend Intern",
          startDate: "2025",
          description: "Built React dashboards for lab scheduling.",
          current: true,
        },
      ],
      answerBank: [
        {
          question: "Why do you want this role?",
          answer: "The role matches the React work I already do.",
          approved: true,
        },
        {
          question: "What are your salary expectations?",
          answer: "Happy to discuss later in the process.",
          approved: false,
        },
      ],
    },
  });
  assert.equal(profile.status, 200);

  const pdf = await makePdf(
    "Meera Nair\nFrontend Engineering Intern\nSkills: JavaScript, React, Node.js\nExperience: Built dashboards at Campus Labs.\nEducation: B.Tech in Information Technology, Example University"
  );

  const upload = await auth(request(app).post("/api/resumes"), token).attach(
    "resume",
    pdf,
    { filename: "meera-resume.pdf", contentType: "application/pdf" }
  );
  assert.equal(upload.status, 201);

  const job = await auth(request(app).post("/api/jobs"), token).send({
    title: "Frontend Engineering Intern",
    company: "Acme Systems",
    description:
      "Build React dashboards with Node.js APIs. 1+ years experience with JavaScript.",
    skills: ["React", "JavaScript", "Node.js"],
    location: "Remote",
    jobType: "internship",
    remote: true,
    applicationUrl: "https://boards.greenhouse.io/acmesystems/jobs/4001",
  });
  assert.equal(job.status, 201);
  jobId = job.body.data.job.id;
  // Creating a job also creates its "saved" tracking record.
  applicationId = job.body.data.job.applicationId;
  assert.ok(applicationId);

  const readiness = await auth(
    request(app).get(`/api/applications/${applicationId}/readiness`),
    token
  );

  assert.equal(readiness.status, 200);
  assert.equal(readiness.headers["cache-control"], "private, no-store");

  const report = readiness.body.data.readiness;
  assert.equal(report.ready, false);
  assert.equal(report.status, "needs_attention");
  assert.ok(report.blocking.includes("approved_resume"));
  assert.equal(report.adapter.key, "greenhouse");
  assert.equal(report.adapter.autofillSupported, true);
  assert.equal(report.applicationStatus, "saved");
  assert.equal(report.statusPreserved, true);
  assert.equal(report.approvedResume, null);

  const approvedCheck = report.checks.find(
    (entry) => entry.id === "approved_resume"
  );
  assert.equal(approvedCheck.status, "fail");
  assert.match(approvedCheck.detail, /no tailored resume/i);
  assert.match(approvedCheck.fix.href, /\/tailored$/);

  const submissionCheck = report.checks.find(
    (entry) => entry.id === "final_submission_guard"
  );
  assert.equal(submissionCheck.status, "pass");
  assert.match(submissionCheck.detail, /you must click/i);
  assert.equal(report.submission.automatic, false);
  assert.equal(report.submission.requiresHumanClick, true);
});

test("an approved revision makes the application ready without changing its status", async () => {
  const generated = await auth(
    request(app).post("/api/tailored-resumes"),
    token
  ).send({ jobId });
  assert.equal(generated.status, 201);
  tailoredResumeId = generated.body.data.tailoredResume.id;

  const approved = await auth(
    request(app).post(`/api/tailored-resumes/${tailoredResumeId}/approve`),
    token
  ).send({ approved: true });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.tailoredResume.status, "approved");

  const readiness = await auth(
    request(app).get(`/api/applications/${applicationId}/readiness`),
    token
  );
  assert.equal(readiness.status, 200);
  const report = readiness.body.data.readiness;

  assert.equal(report.ready, true);
  assert.equal(report.status, "ready");
  assert.deepEqual(report.blocking, []);
  assert.equal(report.applicationStatus, "saved");
  assert.equal(report.approvedResume.id, tailoredResumeId);
  assert.equal(report.approvedResume.revision, 1);
  assert.deepEqual(
    report.approvedResume.files.map((file) => file.format).sort(),
    ["docx", "pdf"]
  );
  assert.ok(
    report.approvedResume.files.every((file) =>
      file.downloadPath.endsWith(`/download/${file.format}`)
    )
  );
  assert.equal(
    report.checks.find((entry) => entry.id === "contact_details").status,
    "pass"
  );
  assert.equal(
    report.checks.find((entry) => entry.id === "resume_files").status,
    "pass"
  );

  const applications = await auth(
    request(app).get("/api/applications"),
    token
  );
  const tracked = applications.body.data.applications.find(
    (entry) => entry.id === applicationId
  );
  assert.equal(tracked.status, "saved");
});

test("readiness evaluates required cover letters and approved screening answers", async () => {
  const requirements = {
    coverLetter: "required",
    questions: [
      "Why do you want this role?",
      "Describe a production API you built.",
    ],
  };

  const beforeResponse = await auth(
    request(app).post(`/api/applications/${applicationId}/readiness`),
    token
  ).send({ requirements });

  assert.equal(beforeResponse.status, 200);
  const report = beforeResponse.body.data.readiness;
  assert.equal(report.ready, false);
  assert.ok(report.blocking.includes("cover_letter"));
  assert.ok(report.blocking.includes("screening_answers"));

  const coverCheck = report.checks.find((entry) => entry.id === "cover_letter");
  assert.equal(coverCheck.status, "fail");
  assert.equal(coverCheck.required, true);

  const answerCheck = report.checks.find(
    (entry) => entry.id === "screening_answers"
  );
  assert.equal(answerCheck.status, "fail");
  assert.equal(report.missingAnswers.length, 1);
  assert.equal(
    report.missingAnswers[0].question,
    "Describe a production API you built."
  );
  assert.ok(
    !report.missingAnswers.some((entry) =>
      /why do you want this role/i.test(entry.question)
    )
  );

  await auth(
    request(app).patch(`/api/applications/${applicationId}`),
    token
  ).send({
    coverLetter: {
      subject: "Frontend Engineering Intern",
      body: "I build React dashboards and would like to do that here.",
    },
  });

  const afterResponse = await auth(
    request(app).post(`/api/applications/${applicationId}/readiness`),
    token
  ).send({ requirements });

  assert.equal(afterResponse.status, 200);
  const updated = afterResponse.body.data.readiness;
  assert.equal(
    updated.checks.find((entry) => entry.id === "cover_letter").status,
    "pass"
  );
  // The salary-style answer was never approved, so an unmatched question stays
  // missing instead of reusing unrelated saved content.
  assert.equal(
    updated.checks.find((entry) => entry.id === "screening_answers").status,
    "fail"
  );
  assert.equal(updated.ready, false);
});

test("autofill plan carries verified values, the approved resume, and a no-submit policy", async () => {
  const response = await auth(
    request(app).get(`/api/applications/${applicationId}/autofill-plan`),
    token
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "private, no-store");

  const plan = response.body.data.plan;
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.canAutofill, true);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.adapter.key, "greenhouse");
  assert.equal(plan.adapter.autofillSupported, true);

  const field = (canonical) =>
    plan.fields.find((entry) => entry.canonical === canonical);

  assert.equal(field("firstName").value, "Meera");
  assert.equal(field("lastName").value, "Nair");
  assert.equal(field("email").value, "meera.autofill@example.com");
  assert.equal(field("phone").value, "+91 90000 00000");
  assert.equal(field("latestSchool").value, "Example University");
  assert.equal(field("latestGraduationYear").value, "2027");
  assert.match(field("skills").value, /React/);
  assert.ok(field("firstName").selectors.length > 0);

  // Values without a portal input stay available for manual copy/paste, and
  // the summary comes from the approved revision rather than a draft.
  const manual = (canonical) =>
    plan.manualValues.find((entry) => entry.canonical === canonical);
  assert.equal(manual("summary").source, "approved_tailored_resume");
  assert.match(manual("summary").value, /Frontend Engineering Intern/);
  assert.match(manual("skills").value, /React/);
  assert.ok(!plan.fields.some((entry) => entry.canonical === "summary"));

  assert.equal(plan.resume.tailoredResumeId, tailoredResumeId);
  assert.equal(plan.resume.revision, 1);
  assert.deepEqual(
    plan.resume.files.map((file) => file.format).sort(),
    ["docx", "pdf"]
  );
  assert.ok(plan.resume.selectors.length > 0);
  assert.ok(plan.resume.files.every((file) => file.size > 500));

  assert.deepEqual(
    plan.answers.map((entry) => entry.question),
    ["Why do you want this role?"]
  );
  assert.ok(!plan.answers.some((entry) => /salary/i.test(entry.question)));

  // No unverified accomplishments exist here, and none may be invented.
  assert.deepEqual(plan.projects, []);
  assert.ok(
    plan.education.some((entry) => entry.institution === "Example University")
  );

  assert.equal(plan.safety.autoSubmit, false);
  assert.equal(plan.safety.finalSubmissionRequiresHuman, true);
  assert.equal(plan.safety.hiddenSubmissionAllowed, false);
  assert.ok(plan.safety.forbiddenActions.length >= 4);
  assert.match(plan.safety.forbiddenActions.join(" "), /CAPTCHA/i);
  assert.equal(plan.manualFallback.supported, true);
  assert.ok(plan.manualFallback.instructions.length >= 3);
  assert.match(plan.helper.command, /tools\/autofill\/cli\.js/);

  assert.ok(plan.coverLetter.body.length > 20);
  assert.ok(plan.coverLetter.selectors.length > 0);
});

test("autofill run reports are audited and can never claim submission", async () => {
  const payload = {
    adapter: "greenhouse",
    pageUrl: "https://boards.greenhouse.io/acmesystems/jobs/4001",
    status: "needs_review",
    filledFields: [
      { canonical: "firstName", label: "First name", selector: "#first_name" },
      { canonical: "email", label: "Email", selector: "#email" },
    ],
    missingFields: [
      {
        canonical: "latestField",
        label: "Field of study",
        reason: "field_not_found",
      },
    ],
    validationErrors: [{ field: "email", message: "Enter a valid email" }],
    unsupportedControls: ["Rich-text editor: Why this role"],
    resumeUploaded: { format: "pdf", fileName: "meera-tailored.pdf" },
    coverLetterFilled: true,
    answersFilled: ["Why do you want this role?"],
    submitted: false,
  };

  const created = await auth(
    request(app).post(`/api/applications/${applicationId}/autofill-runs`),
    token
  ).send(payload);

  assert.equal(created.status, 201);
  assert.equal(created.body.data.run.submitted, false);
  assert.equal(created.body.data.run.status, "needs_review");
  assert.equal(created.body.data.run.resumeUploaded.format, "pdf");
  assert.equal(created.body.data.run.filledFields.length, 2);
  assert.match(
    created.body.data.message,
    /never submits|no application was submitted/i
  );

  const claimed = await auth(
    request(app).post(`/api/applications/${applicationId}/autofill-runs`),
    token
  ).send({ ...payload, submitted: true });

  assert.equal(claimed.status, 400);
  assert.equal(claimed.body.code, "VALIDATION_ERROR");

  const unknownAdapter = await auth(
    request(app).post(`/api/applications/${applicationId}/autofill-runs`),
    token
  ).send({ ...payload, adapter: "hand-rolled" });

  assert.equal(unknownAdapter.status, 400);

  const list = await auth(
    request(app).get(`/api/applications/${applicationId}/autofill-runs`),
    token
  );

  assert.equal(list.status, 200);
  assert.equal(list.body.data.runs.length, 1);
  assert.equal(list.body.data.runs[0].submitted, false);

  const applications = await auth(request(app).get("/api/applications"), token);
  const tracked = applications.body.data.applications.find(
    (entry) => entry.id === applicationId
  );
  assert.equal(tracked.status, "saved");
  assert.equal(tracked.submittedAt, undefined);
});

test("unsupported portals return a manual fallback instead of guessing", async () => {
  const job = await auth(request(app).post("/api/jobs"), token).send({
    title: "React Intern",
    company: "LinkedIn Posting",
    description: "React internship posted through an unsupported portal.",
    skills: ["React"],
    applicationUrl: "https://www.linkedin.com/jobs/view/4012345678",
    jobType: "internship",
  });
  assert.equal(job.status, 201);
  linkedinApplicationId = job.body.data.job.applicationId;
  assert.ok(linkedinApplicationId);

  const plan = await auth(
    request(app).get(`/api/applications/${linkedinApplicationId}/autofill-plan`),
    token
  );

  assert.equal(plan.status, 200);
  const body = plan.body.data.plan;
  assert.equal(body.adapter.key, "linkedin");
  assert.equal(body.adapter.supported, false);
  assert.equal(body.adapter.autofillSupported, false);
  assert.equal(body.canAutofill, false);
  assert.equal(body.fields.length, 0);
  assert.equal(body.blockers[0].code, "unsupported_portal");
  assert.match(body.blockers[0].detail, /terms|login/i);
  assert.ok(body.manualFallback.instructions.length >= 3);
});

test("readiness, plans, and run reports stay private to their owner", async () => {
  const paths = [
    `/api/applications/${applicationId}/readiness`,
    `/api/applications/${applicationId}/autofill-plan`,
    `/api/applications/${applicationId}/autofill-runs`,
  ];

  for (const path of paths) {
    const response = await auth(request(app).get(path), otherToken);
    assert.equal(response.status, 404, `${path} should be private`);
  }

  const foreignRun = await auth(
    request(app).post(`/api/applications/${applicationId}/autofill-runs`),
    otherToken
  ).send({ adapter: "greenhouse", status: "prepared" });

  assert.equal(foreignRun.status, 404);
});

test("adapter registry lists supported and unsupported portals and detects by URL", async () => {
  const list = await auth(request(app).get("/api/autofill/adapters"), token);

  assert.equal(list.status, 200);
  const keys = list.body.data.adapters.map((adapter) => adapter.key);
  for (const key of [
    "greenhouse",
    "lever",
    "ashby",
    "linkedin",
    "workday",
    "generic",
  ]) {
    assert.ok(keys.includes(key), `missing adapter ${key}`);
  }

  const greenhouse = list.body.data.adapters.find(
    (adapter) => adapter.key === "greenhouse"
  );
  assert.equal(greenhouse.supported, true);
  assert.equal(greenhouse.autofillSupported, true);
  assert.ok(greenhouse.fieldCount > 0);

  const unsupported = list.body.data.adapters.find(
    (adapter) => adapter.key === "workday"
  );
  assert.equal(unsupported.supported, false);
  assert.match(unsupported.unsupportedReason, /account/i);

  const detected = await auth(
    request(app)
      .get("/api/autofill/adapters/detect")
      .query({ url: "https://jobs.lever.co/acme/1234" }),
    token
  );

  assert.equal(detected.status, 200);
  assert.equal(detected.body.data.detected, true);
  assert.equal(detected.body.data.adapter.key, "lever");

  const generic = await auth(
    request(app)
      .get("/api/autofill/adapters/detect")
      .query({ url: "https://careers.example.com/apply/42" }),
    token
  );

  assert.equal(generic.status, 200);
  assert.equal(generic.body.data.detected, false);
  assert.equal(generic.body.data.adapter.key, "generic");
  assert.equal(generic.body.data.adapter.supported, false);

  const invalid = await auth(
    request(app)
      .get("/api/autofill/adapters/detect")
      .query({ url: "not-a-url" }),
    token
  );

  assert.equal(invalid.status, 400);
});
