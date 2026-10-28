import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph } from "docx";

process.env.NODE_ENV = "test";
process.env.PORT = "0";
process.env.JWT_SECRET = "integration-test-secret-with-enough-length-123";
// Pin the in-memory MongoDB binary so test runs do not depend on whichever
// version the package currently defaults to.
process.env.MONGOMS_VERSION = "7.0.14";
// URL-import fixtures run on loopback over plain HTTP. These flags are refused
// in production by the environment schema.
process.env.URL_IMPORT_ALLOW_HTTP = "true";
process.env.URL_IMPORT_ALLOW_PRIVATE_HOSTS = "true";

const mongoServer = await MongoMemoryServer.create();
process.env.MONGO_URI = mongoServer.getUri("internship_test");

const { default: app } = await import("../src/app.js");
const { connectDB, disconnectDB } = await import("../src/config/db.js");
const { User } = await import("../src/models/User.js");
const { Job } = await import("../src/models/Job.js");
const { Resume } = await import("../src/models/Resume.js");
const { Application } = await import("../src/models/Application.js");
const { Activity } = await import("../src/models/Activity.js");
const { TailoredResume } = await import("../src/models/TailoredResume.js");
const { clearJobsCache } = await import("../src/services/jobsProvider.js");

let primaryToken;
let primaryUserId;
let secondaryToken;
let primaryJobId;
let primaryApplicationId;
let resumeId;
let tailoredResumeId;
let regeneratedTailoredId;

const primary = {
  name: "Asha Verma",
  email: "asha.integration@example.com",
  password: "StrongPass123",
};

const secondary = {
  name: "Ravi Kumar",
  email: "ravi.integration@example.com",
  password: "AnotherPass123",
};

function binaryParser(res, callback) {
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

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

async function makeDocx(text) {
  return Packer.toBuffer(
    new Document({
      sections: [{ children: [new Paragraph(text)] }],
    })
  );
}

before(async () => {
  await connectDB();
  await Promise.all([
    User.init(),
    Job.init(),
    Resume.init(),
    Application.init(),
    Activity.init(),
    TailoredResume.init(),
  ]);
});

after(async () => {
  await disconnectDB();
  await mongoServer.stop();
});

test("registration validates passwords", async () => {
  const response = await request(app).post("/api/auth/register").send({
    name: "Weak User",
    email: "weak@example.com",
    password: "short",
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
  assert.ok(Array.isArray(response.body.errors));
});

test("registration creates an account and returns a JWT", async () => {
  const response = await request(app).post("/api/auth/register").send(primary);

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.ok(response.body.data.token);
  assert.equal(response.body.data.user.email, primary.email);
  assert.equal(response.body.data.user.passwordHash, undefined);
  assert.equal(response.body.data.user.tokenVersion, undefined);

  primaryToken = response.body.data.token;
  primaryUserId = response.body.data.user.id;
});

test("duplicate registration is rejected", async () => {
  const response = await request(app).post("/api/auth/register").send(primary);

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "CONFLICT");
});

test("login rejects an incorrect password and accepts the correct one", async () => {
  const bad = await request(app).post("/api/auth/login").send({
    email: primary.email,
    password: "WrongPass123",
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, "UNAUTHORIZED");

  const good = await request(app).post("/api/auth/login").send({
    email: primary.email,
    password: primary.password,
  });
  assert.equal(good.status, 200);
  assert.ok(good.body.data.token);
});

test("protected routes require a valid bearer token", async () => {
  const missing = await request(app).get("/api/users/me");
  assert.equal(missing.status, 401);

  const invalid = await request(app)
    .get("/api/users/me")
    .set("Authorization", "Bearer not-a-real-token");
  assert.equal(invalid.status, 401);
});

test("profile update persists data and reports completeness", async () => {
  const response = await request(app)
    .patch("/api/users/me")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({
      name: "Asha Verma",
      profile: {
        headline: "Backend Engineering Intern",
        summary:
          "Node.js developer focused on REST APIs, MongoDB, and automated testing. Building reliable backend systems.",
        location: "Bengaluru, India",
        skills: ["JavaScript", "Node.js", "MongoDB", "React", "Express"],
        preferredRoles: ["Backend Engineer", "Software Engineering Intern"],
        preferredLocations: ["Remote", "Bengaluru"],
        jobPreferences: {
          jobTypes: ["internship", "full-time"],
          remoteOnly: false,
          availability: "Immediately",
        },
        education: [
          {
            institution: "Example Institute of Technology",
            degree: "B.Tech",
            field: "Computer Science",
            startYear: 2022,
            endYear: 2026,
          },
        ],
        experience: [
          {
            company: "Campus Labs",
            title: "Backend Intern",
            startDate: "2025",
            endDate: "2026",
            description: "Built Express APIs and MongoDB models.",
          },
        ],
      },
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.user.profile.headline, "Backend Engineering Intern");
  assert.ok(response.body.data.user.profileCompleteness.percent >= 80);
  assert.ok(
    !response.body.data.user.profileCompleteness.missing.includes("name")
  );
  assert.deepEqual(response.body.data.user.profile.jobPreferences.jobTypes, [
    "internship",
    "full-time",
  ]);
});

test("invalid profile URLs are rejected", async () => {
  const response = await request(app)
    .patch("/api/users/me")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ profile: { portfolioUrl: "not-a-url" } });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
});

test("profile stores projects, certifications, achievements, answer bank, and work authorization", async () => {
  const response = await request(app)
    .patch("/api/users/me")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({
      profile: {
        projects: [
          {
            name: "Campus Queue Service",
            description: "A queueing service for campus lab equipment.",
            technologies: ["Node.js", "MongoDB", "Docker"],
            url: "https://github.com/asha/campus-queue",
            accomplishments: [
              { text: "Cut average wait time by 35%", verified: true },
              { text: "Handled 1,200 requests per day", verified: false },
            ],
          },
        ],
        certifications: [
          {
            name: "AWS Certified Cloud Practitioner",
            issuer: "Amazon Web Services",
            issueDate: "2025",
            credentialId: "AWS-123",
            url: "https://aws.example/verify/123",
          },
        ],
        achievements: [
          {
            title: "Smart India Hackathon winner",
            issuer: "Ministry of Education",
            date: "2025",
            description: "Won the national backend track.",
          },
        ],
        answerBank: [
          {
            question: "Why do you want this role?",
            answer: "The backend scope matches the systems I have built.",
            approved: true,
          },
          {
            question: "What are your salary expectations?",
            answer: "I would prefer to discuss this later in the process.",
            approved: false,
          },
        ],
        workAuthorization: {
          status: "work_visa",
          requiresSponsorship: true,
          note: "Valid until 2028",
        },
        jobPreferences: {
          workModes: ["hybrid", "remote"],
          willRelocate: true,
          noticePeriod: "30 days",
        },
      },
    });

  assert.equal(response.status, 200);
  const profile = response.body.data.user.profile;

  assert.equal(profile.projects.length, 1);
  assert.deepEqual(profile.projects[0].technologies, ["Node.js", "MongoDB", "Docker"]);
  assert.equal(profile.projects[0].accomplishments[0].verified, true);
  assert.equal(profile.projects[0].accomplishments[1].verified, false);
  assert.equal(profile.certifications[0].issuer, "Amazon Web Services");
  assert.equal(profile.achievements[0].title, "Smart India Hackathon winner");
  assert.equal(profile.answerBank.length, 2);
  assert.equal(profile.answerBank[0].approved, true);
  assert.ok(profile.answerBank[0].approvedAt);
  assert.equal(profile.answerBank[1].approved, false);
  assert.equal(profile.answerBank[1].approvedAt, undefined);
  assert.equal(profile.workAuthorization.status, "work_visa");
  assert.equal(profile.workAuthorization.requiresSponsorship, true);
  assert.deepEqual(profile.jobPreferences.workModes, ["hybrid", "remote"]);
  assert.equal(profile.jobPreferences.noticePeriod, "30 days");
  assert.ok(
    !response.body.data.user.profileCompleteness.missing.includes("projects")
  );
});

test("profile extensions reject invalid nested values", async () => {
  const badProjectUrl = await request(app)
    .patch("/api/users/me")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ profile: { projects: [{ name: "Unsafe", url: "javascript:alert(1)" }] } });
  assert.equal(badProjectUrl.status, 400);
  assert.equal(badProjectUrl.body.code, "VALIDATION_ERROR");

  const badAnswer = await request(app)
    .patch("/api/users/me")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ profile: { answerBank: [{ question: "Why?", answer: "" }] } });
  assert.equal(badAnswer.status, 400);

  const badWorkStatus = await request(app)
    .patch("/api/users/me")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ profile: { workAuthorization: { status: "not-a-status" } } });
  assert.equal(badWorkStatus.status, 400);
});

test("PDF resume upload parses text and skills", async () => {
  const pdf = await makePdf(`Asha Verma
Backend Engineering Intern
Skills: JavaScript, Node.js, Express, MongoDB, React, REST APIs, Git, Docker
Experience: Built REST APIs with Node.js and MongoDB over 2 years.
Education: Bachelor of Technology in Computer Science, Example Institute of Technology
Projects: Developed an internship tracker using Express and React.`);

  const response = await request(app)
    .post("/api/resumes")
    .set("Authorization", `Bearer ${primaryToken}`)
    .attach("resume", pdf, {
      filename: "asha-resume.pdf",
      contentType: "application/pdf",
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.resume.originalName, "asha-resume.pdf");
  assert.ok(response.body.data.resume.parsed.skills.includes("JavaScript"));
  assert.ok(response.body.data.resume.parsed.skills.includes("MongoDB"));
  assert.ok(response.body.data.resume.parsed.wordCount > 20);

  resumeId = response.body.data.resume.id;
});

test("resume text is available only to its owner and is never public", async () => {
  const own = await request(app)
    .get("/api/resumes/me")
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(own.status, 200);
  assert.match(own.body.data.resume.text, /Backend Engineering Intern/i);
  assert.equal(own.body.data.resume.fileData, undefined);

  const download = await request(app)
    .get("/api/resumes/me/file")
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(download.status, 200);
  assert.equal(download.headers["content-type"], "application/pdf");
  assert.equal(download.headers["cache-control"], "private, no-store");
  assert.match(download.headers["content-disposition"], /attachment/);
  assert.equal(download.body.subarray(0, 5).toString(), "%PDF-");
});

test("resume replacement with DOCX works and unsupported files are rejected", async () => {
  const docx = await makeDocx(
    "Asha Verma - Backend Engineer. Skills: JavaScript, TypeScript, Node.js, MongoDB, Docker, AWS. 3 years experience building APIs."
  );

  const replaced = await request(app)
    .post("/api/resumes")
    .set("Authorization", `Bearer ${primaryToken}`)
    .attach("resume", docx, {
      filename: "asha-resume.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

  assert.equal(replaced.status, 200);
  assert.equal(replaced.body.data.replaced, true);
  assert.ok(replaced.body.data.resume.parsed.skills.includes("TypeScript"));

  const rejected = await request(app)
    .post("/api/resumes")
    .set("Authorization", `Bearer ${primaryToken}`)
    .attach("resume", Buffer.from("plain text"), {
      filename: "resume.txt",
      contentType: "text/plain",
    });

  assert.equal(rejected.status, 400);
});

test("resume extraction review compares parsed data with the verified profile", async () => {
  const structured = await makeDocx(`Asha Verma
Senior Backend Developer
asha.verma@example.com | +91 98765 43210
https://linkedin.com/in/ashaverma
https://github.com/ashaverma

PROJECTS
Internship Tracker
Built a Node.js and Express application that tracks 200+ applications.
- Reduced duplicate entries by 40% with deduplication logic
- Added MongoDB indexes that cut query time by 60%

CERTIFICATIONS
AWS Certified Cloud Practitioner, Amazon Web Services, 2025
Coursera Advanced Node.js, Coursera, 2024

ACHIEVEMENTS
Winner, Smart India Hackathon 2025
Top 10 rank in institute coding contest`);

  const upload = await request(app)
    .post("/api/resumes")
    .set("Authorization", `Bearer ${primaryToken}`)
    .attach("resume", structured, {
      filename: "asha-structured-resume.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

  assert.equal(upload.status, 200);
  assert.ok(upload.body.data.resume.parsed.proposals.projects.length >= 1);

  const review = await request(app)
    .get("/api/resumes/me/extraction")
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(review.status, 200);
  assert.equal(review.headers["cache-control"], "private, no-store");

  const data = review.body.data.review;
  assert.equal(data.proposals.headline, "Senior Backend Developer");
  assert.equal(data.proposals.contact.email, "asha.verma@example.com");
  assert.match(data.proposals.contact.phone, /98765/);
  assert.equal(
    data.proposals.contact.linkedinUrl,
    "https://linkedin.com/in/ashaverma"
  );

  const project = data.proposals.projects.find(
    (entry) => entry.name === "Internship Tracker"
  );
  assert.ok(project);
  assert.ok(project.technologies.includes("Express"));
  assert.ok(project.accomplishments.length >= 2);
  assert.ok(data.proposals.certifications.length >= 2);
  assert.ok(data.proposals.achievements.length >= 2);

  const conflict = data.conflicts.find((entry) => entry.field === "headline");
  assert.ok(conflict);
  assert.equal(conflict.current, "Backend Engineering Intern");
  assert.equal(conflict.proposed, "Senior Backend Developer");

  // Reviewing must never write to the profile.
  const me = await request(app)
    .get("/api/users/me")
    .set("Authorization", `Bearer ${primaryToken}`);
  assert.equal(me.body.data.user.profile.headline, "Backend Engineering Intern");
  assert.ok(
    !me.body.data.user.profile.projects.some(
      (entry) => entry.name === "Internship Tracker"
    )
  );
});

test("applying extraction protects verified values unless explicitly allowed", async () => {
  const unreviewed = await request(app)
    .post("/api/resumes/me/extraction/apply")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ reviewed: false });
  assert.equal(unreviewed.status, 400);
  assert.equal(unreviewed.body.code, "VALIDATION_ERROR");

  const applied = await request(app)
    .post("/api/resumes/me/extraction/apply")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({
      reviewed: true,
      fields: { headline: "Senior Backend Developer" },
      skills: ["TypeScript"],
    });

  assert.equal(applied.status, 200);
  const profile = applied.body.data.user.profile;

  assert.equal(profile.headline, "Backend Engineering Intern");
  assert.ok(
    applied.body.data.skipped.some(
      (entry) =>
        entry.field === "headline" &&
        entry.reason === "existing_value_protected"
    )
  );
  assert.ok(profile.skills.includes("TypeScript"));

  const extractedProject = profile.projects.find(
    (entry) => entry.name === "Internship Tracker"
  );
  assert.ok(extractedProject);
  assert.ok(extractedProject.technologies.includes("Express"));
  assert.ok(extractedProject.accomplishments.length >= 2);
  assert.ok(
    extractedProject.accomplishments.every((entry) => entry.verified === false)
  );
  assert.ok(
    profile.certifications.some((entry) => /Coursera/i.test(entry.name))
  );
  assert.ok(
    profile.achievements.some((entry) => /top 10/i.test(entry.title))
  );

  const override = await request(app)
    .post("/api/resumes/me/extraction/apply")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({
      reviewed: true,
      overwriteVerified: true,
      fields: { headline: "Senior Backend Developer" },
    });

  assert.equal(override.status, 200);
  assert.equal(
    override.body.data.user.profile.headline,
    "Senior Backend Developer"
  );
  assert.ok(
    override.body.data.skipped.some((entry) => entry.reason === "duplicate")
  );
});

test("manual job creation validates and prevents duplicates", async () => {
  const invalid = await request(app)
    .post("/api/jobs")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ title: "x" });
  assert.equal(invalid.status, 400);

  const jobPayload = {
    title: "Backend Engineering Intern",
    company: "Acme Systems",
    description:
      "Build REST APIs with Node.js, Express, and MongoDB. Work with Docker and AWS. 1+ years experience with JavaScript.",
    skills: ["JavaScript", "Node.js", "Express", "MongoDB", "Docker"],
    location: "Remote",
    jobType: "internship",
    remote: true,
    applicationUrl: "https://acme.example/careers/backend-intern",
    postedAt: "2026-09-01T00:00:00.000Z",
  };

  const created = await request(app)
    .post("/api/jobs")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send(jobPayload);

  assert.equal(created.status, 201);
  assert.equal(created.body.data.job.applicationStatus, "saved");
  primaryJobId = created.body.data.job.id;

  const duplicate = await request(app)
    .post("/api/jobs")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send(jobPayload);
  assert.equal(duplicate.status, 409);
});

test("job search, filters, sorting, and pagination work", async () => {
  const second = await request(app)
    .post("/api/jobs")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({
      title: "Frontend Developer Intern",
      company: "Beta Labs",
      description: "Build accessible React interfaces with TypeScript and CSS.",
      skills: ["React", "TypeScript", "CSS"],
      location: "Bengaluru",
      jobType: "internship",
      remote: false,
      applicationUrl: "https://beta.example/jobs/frontend-intern",
    });

  assert.equal(second.status, 201);

  const search = await request(app)
    .get("/api/jobs?q=React&limit=1&page=1")
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(search.status, 200);
  assert.equal(search.body.data.jobs.length, 1);
  assert.equal(search.body.meta.total, 1);
  assert.equal(search.body.meta.totalPages, 1);

  const filtered = await request(app)
    .get("/api/jobs?remote=true&jobType=internship&sort=title")
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.data.jobs.length, 1);
  assert.equal(filtered.body.data.jobs[0].title, "Backend Engineering Intern");

  const byStatus = await request(app)
    .get("/api/jobs?status=saved")
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(byStatus.status, 200);
  assert.equal(byStatus.body.meta.total, 2);
});

test("job detail includes an explainable match using resume and profile", async () => {
  const response = await request(app)
    .get(`/api/jobs/${primaryJobId}`)
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(response.status, 200);
  assert.ok(response.body.data.match.score > 50);
  assert.ok(response.body.data.match.matchedSkills.includes("Node.js"));
  assert.ok(response.body.data.match.reasons.length >= 3);
  assert.ok(response.body.data.match.components.skills > 0);
});

test("users cannot access another user's job or application", async () => {
  const registration = await request(app)
    .post("/api/auth/register")
    .send(secondary);
  assert.equal(registration.status, 201);
  secondaryToken = registration.body.data.token;

  const job = await request(app)
    .get(`/api/jobs/${primaryJobId}`)
    .set("Authorization", `Bearer ${secondaryToken}`);
  assert.equal(job.status, 404);

  const application = await request(app)
    .patch(`/api/applications/${primaryJobId}`)
    .set("Authorization", `Bearer ${secondaryToken}`)
    .send({ status: "planned" });
  assert.equal(application.status, 404);

  // Resume extraction never exposes another user's document or profile data.
  const extraction = await request(app)
    .get("/api/resumes/me/extraction")
    .set("Authorization", `Bearer ${secondaryToken}`);
  assert.equal(extraction.status, 404);
});

test("tailored generation uses only verified profile facts and builds both formats", async () => {
  const before = await request(app)
    .get("/api/resumes/me")
    .set("Authorization", `Bearer ${primaryToken}`);

  // Keep one parsed resume skill (AWS) out of the verified profile so the
  // source-document comparison has a real omission to report.
  const me = await request(app)
    .get("/api/users/me")
    .set("Authorization", `Bearer ${primaryToken}`);
  const verifiedSkills = me.body.data.user.profile.skills.filter(
    (skill) => skill !== "AWS"
  );
  const trimmedProfile = await request(app)
    .patch("/api/users/me")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ profile: { skills: verifiedSkills } });
  assert.equal(trimmedProfile.status, 200);

  const response = await request(app)
    .post("/api/tailored-resumes")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ jobId: primaryJobId });

  assert.equal(response.status, 201);

  const tailored = response.body.data.tailoredResume;
  tailoredResumeId = tailored.id;

  assert.equal(tailored.revision, 1);
  assert.equal(tailored.status, "draft");
  assert.equal(tailored.provider, "heuristic");
  assert.equal(String(tailored.baseResumeId), before.body.data.resume.id);
  assert.equal(tailored.files.length, 2);
  assert.deepEqual(
    tailored.files.map((file) => file.format).sort(),
    ["docx", "pdf"]
  );
  assert.ok(tailored.files.every((file) => file.size > 500));
  assert.ok(tailored.files.every((file) => file.checksum.length === 64));
  assert.equal(tailored.files[0].data, undefined);

  // Every skill in the document comes from the verified profile.
  assert.ok(verifiedSkills.length > 0);
  assert.equal(tailored.diff.skills.added.length, 0);
  assert.deepEqual(
    [...tailored.content.skills].sort(),
    [...verifiedSkills].sort()
  );

  // The original uploaded document is compared explicitly, without copying
  // skills that were never verified into the profile.
  assert.equal(
    tailored.diff.sourceResume.id,
    String(tailored.baseResumeId)
  );
  assert.ok(tailored.diff.sourceResume.skillsOmitted.includes("AWS"));
  assert.ok(
    !tailored.diff.sourceResume.skillsOmitted.includes("TypeScript")
  );
  assert.match(tailored.diff.sourceResume.note, /verified profile/i);

  const verifiedProject = tailored.content.projects.find(
    (project) => project.name === "Campus Queue Service"
  );
  assert.deepEqual(verifiedProject.accomplishments, [
    { text: "Cut average wait time by 35%", verified: true },
  ]);

  const extractedProject = tailored.content.projects.find(
    (project) => project.name === "Internship Tracker"
  );
  assert.deepEqual(extractedProject.accomplishments, []);
  assert.ok(tailored.changes.omitted.length >= 2);

  // The original private resume is untouched by generation.
  const after = await request(app)
    .get("/api/resumes/me")
    .set("Authorization", `Bearer ${primaryToken}`);
  assert.equal(after.body.data.resume.id, before.body.data.resume.id);
  assert.equal(after.body.data.resume.checksum, before.body.data.resume.checksum);
  assert.equal(after.body.data.resume.uploadedAt, before.body.data.resume.uploadedAt);
});

test("tailored resumes list, download, and stay private to their owner", async () => {
  const list = await request(app)
    .get(`/api/tailored-resumes?jobId=${primaryJobId}`)
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(list.status, 200);
  assert.equal(list.body.data.tailoredResumes.length, 1);
  assert.equal(list.body.data.tailoredResumes[0].isLatestRevision, true);
  assert.equal(list.body.data.tailoredResumes[0].files[0].data, undefined);

  const detail = await request(app)
    .get(`/api/tailored-resumes/${tailoredResumeId}`)
    .set("Authorization", `Bearer ${primaryToken}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.body.data.tailoredResume.diff.summary.changed);
  assert.equal(detail.body.data.tailoredResume.downloads.pdf.endsWith("/pdf"), true);

  const pdf = await request(app)
    .get(`/api/tailored-resumes/${tailoredResumeId}/download/pdf`)
    .set("Authorization", `Bearer ${primaryToken}`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers["content-type"], "application/pdf");
  assert.equal(pdf.headers["cache-control"], "private, no-store");
  assert.match(pdf.headers["content-disposition"], /attachment/);
  assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");

  const docx = await request(app)
    .get(`/api/tailored-resumes/${tailoredResumeId}/download/docx`)
    .set("Authorization", `Bearer ${primaryToken}`)
    .buffer(true)
    .parse(binaryParser);
  assert.equal(docx.status, 200);
  assert.equal(docx.body.subarray(0, 2).toString(), "PK");

  const badFormat = await request(app)
    .get(`/api/tailored-resumes/${tailoredResumeId}/download/exe`)
    .set("Authorization", `Bearer ${primaryToken}`);
  assert.equal(badFormat.status, 400);

  const foreignDetail = await request(app)
    .get(`/api/tailored-resumes/${tailoredResumeId}`)
    .set("Authorization", `Bearer ${secondaryToken}`);
  assert.equal(foreignDetail.status, 404);

  const foreignDownload = await request(app)
    .get(`/api/tailored-resumes/${tailoredResumeId}/download/pdf`)
    .set("Authorization", `Bearer ${secondaryToken}`);
  assert.equal(foreignDownload.status, 404);

  const foreignCreate = await request(app)
    .post("/api/tailored-resumes")
    .set("Authorization", `Bearer ${secondaryToken}`)
    .send({ jobId: primaryJobId });
  assert.equal(foreignCreate.status, 404);
});

test("tailored resumes can be edited, explicitly approved, and regenerated as new revisions", async () => {
  const edited = await request(app)
    .patch(`/api/tailored-resumes/${tailoredResumeId}`)
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({
      content: {
        summary: "Edited summary focused on backend APIs.",
        skills: ["JavaScript", "Node.js"],
      },
    });

  assert.equal(edited.status, 200);
  assert.equal(
    edited.body.data.tailoredResume.content.summary,
    "Edited summary focused on backend APIs."
  );
  assert.deepEqual(edited.body.data.tailoredResume.content.skills, [
    "JavaScript",
    "Node.js",
  ]);
  assert.equal(edited.body.data.tailoredResume.status, "draft");
  assert.equal(edited.body.data.tailoredResume.files.length, 2);

  const unapproved = await request(app)
    .post(`/api/tailored-resumes/${tailoredResumeId}/approve`)
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ approved: false });
  assert.equal(unapproved.status, 400);

  const approved = await request(app)
    .post(`/api/tailored-resumes/${tailoredResumeId}/approve`)
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ approved: true });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.tailoredResume.status, "approved");
  assert.ok(approved.body.data.tailoredResume.approvedAt);

  const editApproved = await request(app)
    .patch(`/api/tailored-resumes/${tailoredResumeId}`)
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ content: { summary: "Changed again" } });
  assert.equal(editApproved.status, 409);

  const regenerated = await request(app)
    .post(`/api/tailored-resumes/${tailoredResumeId}/regenerate`)
    .set("Authorization", `Bearer ${primaryToken}`);
  assert.equal(regenerated.status, 201);
  assert.equal(regenerated.body.data.tailoredResume.revision, 2);
  assert.equal(regenerated.body.data.tailoredResume.status, "draft");
  assert.notEqual(regenerated.body.data.tailoredResume.id, tailoredResumeId);
  regeneratedTailoredId = regenerated.body.data.tailoredResume.id;

  const versions = await request(app)
    .get(`/api/tailored-resumes?jobId=${primaryJobId}`)
    .set("Authorization", `Bearer ${primaryToken}`);
  assert.equal(versions.body.data.tailoredResumes.length, 2);
  const latest = versions.body.data.tailoredResumes.find(
    (entry) => entry.id === regeneratedTailoredId
  );
  const approvedVersion = versions.body.data.tailoredResumes.find(
    (entry) => entry.id === tailoredResumeId
  );
  assert.equal(latest.isLatestRevision, true);
  assert.equal(approvedVersion.isLatestRevision, false);
  assert.equal(approvedVersion.status, "approved");
});

test("application preview only offers an approved tailored resume", async () => {
  const applications = await request(app)
    .get("/api/applications")
    .set("Authorization", `Bearer ${primaryToken}`);

  const application = applications.body.data.applications.find(
    (entry) => entry.job?.id === primaryJobId
  );
  assert.ok(application);

  const preview = await request(app)
    .get(`/api/applications/${application.id}/preview`)
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(preview.status, 200);
  assert.equal(preview.body.data.tailoredResume.revision, 1);
  assert.equal(
    preview.body.data.tailoredResume.id,
    tailoredResumeId
  );
  assert.equal(preview.body.data.tailoredResumeWorkflow.approvedRequired, true);
  assert.equal(preview.body.data.tailoredResumeWorkflow.draftAvailable, true);
  assert.equal(
    preview.body.data.tailoredResumeWorkflow.latestDraftRevision,
    2
  );
});

test("application status cannot be submitted without explicit confirmation", async () => {
  const list = await request(app)
    .get("/api/applications")
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(list.status, 200);
  assert.ok(list.body.data.applications.length >= 2);
  primaryApplicationId = list.body.data.applications[0].id;

  const directSubmit = await request(app)
    .patch(`/api/applications/${primaryApplicationId}`)
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ status: "submitted" });

  assert.equal(directSubmit.status, 400);
  assert.match(directSubmit.body.message, /explicit submission/i);

  const unapproved = await request(app)
    .post(`/api/applications/${primaryApplicationId}/submit`)
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ approved: false, confirmation: true, method: "manual" });

  assert.equal(unapproved.status, 400);
});

test("application preview contains verified prefill data and no automation", async () => {
  const response = await request(app)
    .get(`/api/applications/${primaryApplicationId}/preview`)
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.workflow.automatedSubmission, false);
  assert.equal(response.body.data.workflow.requiresExplicitApproval, true);
  assert.ok(
    response.body.data.prefill.fields.some(
      (field) => field.key === "fullName" && field.value === primary.name
    )
  );
  assert.match(response.body.data.job.applicationUrl, /^https:\/\//);
});

test("application preview only offers approved answer-bank entries", async () => {
  const response = await request(app)
    .get(`/api/applications/${primaryApplicationId}/preview`)
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(response.status, 200);

  const { answers } = response.body.data.prefill;
  assert.equal(answers.length, 1);
  assert.equal(answers[0].question, "Why do you want this role?");
  assert.match(answers[0].answer, /backend scope/i);
  assert.ok(answers[0].approvedAt);
  assert.ok(
    !answers.some((entry) => /salary/i.test(entry.question))
  );

  const authorization = response.body.data.prefill.fields.find(
    (field) => field.key === "workAuthorization"
  );
  assert.ok(authorization);
  assert.equal(authorization.value, "work visa");
});

test("approved submission is recorded and status transitions are tracked", async () => {
  const planned = await request(app)
    .patch(`/api/applications/${primaryApplicationId}`)
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ status: "planned", notes: "Review the job description" });

  assert.equal(planned.status, 200);
  assert.equal(planned.body.data.application.status, "planned");

  const submitted = await request(app)
    .post(`/api/applications/${primaryApplicationId}/submit`)
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ approved: true, confirmation: true, method: "manual" });

  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.data.application.status, "submitted");
  assert.ok(submitted.body.data.application.submittedAt);
  assert.equal(submitted.body.data.application.submissionMethod, "manual");
  assert.ok(
    submitted.body.data.application.statusHistory.some(
      (entry) => entry.status === "submitted"
    )
  );
});

test("AI endpoints return a clearly labeled template fallback without credentials", async () => {
  const coverLetter = await request(app)
    .post("/api/ai/cover-letter")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ jobId: primaryJobId, tone: "professional" });

  assert.equal(coverLetter.status, 200);
  assert.equal(coverLetter.body.data.coverLetter.provider, "template");
  assert.match(coverLetter.body.data.coverLetter.notice, /AI is not configured/i);
  assert.match(coverLetter.body.data.coverLetter.subject, /Backend Engineering Intern/);
  assert.ok(coverLetter.body.data.coverLetter.body.includes(primary.name));

  const suggestions = await request(app)
    .post("/api/ai/resume-suggestions")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ jobId: primaryJobId });

  assert.equal(suggestions.status, 200);
  assert.equal(suggestions.body.data.provider, "template");
  assert.ok(suggestions.body.data.suggestions.length > 0);
});

test("edited cover letters persist for the application preview", async () => {
  const editedBody =
    "Dear Hiring Manager,\n\nI have edited this draft to reflect only my verified experience.";

  const update = await request(app)
    .patch(`/api/applications/${primaryApplicationId}`)
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({
      coverLetter: {
        subject: "Application for Backend Engineering Intern",
        body: editedBody,
      },
    });

  assert.equal(update.status, 200);
  assert.equal(update.body.data.application.coverLetter.provider, "manual_edit");

  const preview = await request(app)
    .get(`/api/applications/${primaryApplicationId}/preview`)
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(preview.status, 200);
  assert.equal(preview.body.data.prefill.coverLetter, editedBody);
});

test("AI request validation rejects malformed input", async () => {
  const response = await request(app)
    .post("/api/ai/application-answers")
    .set("Authorization", `Bearer ${primaryToken}`)
    .send({ jobId: "bad-id", questions: [] });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
});

test("live job discovery is normalized and imports are deduplicated", async () => {
  const originalFetch = global.fetch;
  clearJobsCache();

  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      jobs: [
        {
          id: 987654,
          title: "Platform Engineering Intern",
          company_name: "Live Co",
          description:
            "<p>Work on Node.js services and MongoDB. 1+ years experience.</p>",
          candidate_required_location: "Remote",
          job_type: "internship",
          url: "https://live.example/jobs/987654",
          publication_date: "2026-10-01T00:00:00Z",
          category: "Software Development",
        },
      ],
    }),
  });

  try {
    const discovered = await request(app)
      .get("/api/jobs/discover?search=platform&limit=5")
      .set("Authorization", `Bearer ${primaryToken}`);

    assert.equal(discovered.status, 200);
    assert.equal(discovered.body.data.source, "remotive");
    assert.equal(discovered.body.data.jobs.length, 1);
    assert.equal(discovered.body.data.jobs[0].externalId, "987654");
    assert.ok(discovered.body.data.jobs[0].skills.includes("Node.js"));

    const imported = await request(app)
      .post("/api/jobs/import")
      .set("Authorization", `Bearer ${primaryToken}`)
      .send({ externalId: "987654" });

    assert.equal(imported.status, 201);
    assert.equal(imported.body.data.created, true);
    assert.equal(imported.body.data.job.source, "remotive");

    const again = await request(app)
      .post("/api/jobs/import")
      .set("Authorization", `Bearer ${primaryToken}`)
      .send({ externalId: "987654" });

    assert.equal(again.status, 200);
    assert.equal(again.body.data.created, false);
  } finally {
    global.fetch = originalFetch;
    clearJobsCache();
  }
});

test("discovery fails honestly when the provider is unreachable", async () => {
  const originalFetch = global.fetch;
  clearJobsCache();

  global.fetch = async () => {
    throw new Error("network down");
  };

  try {
    const response = await request(app)
      .get("/api/jobs/discover?search=unique-outage-test&limit=5")
      .set("Authorization", `Bearer ${primaryToken}`);

    assert.equal(response.status, 503);
    assert.equal(response.body.code, "SERVICE_UNAVAILABLE");
    assert.match(response.body.message, /unreachable|unavailable/i);
  } finally {
    global.fetch = originalFetch;
    clearJobsCache();
  }
});

test("dashboard aggregates real data", async () => {
  const response = await request(app)
    .get("/api/dashboard")
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(response.status, 200);
  assert.ok(response.body.data.stats.totalTracked >= 3);
  assert.equal(
    response.body.data.statusBreakdown.find(
      (entry) => entry.status === "submitted"
    ).count,
    1
  );
  assert.ok(response.body.data.recommendedJobs.length > 0);
  assert.ok(response.body.data.recommendedJobs[0].match.score >= 0);
  assert.equal(response.body.data.ai.provider, "template");
  assert.ok(response.body.data.profileCompleteness.percent > 0);
  assert.ok(response.body.data.resume);
  assert.ok(
    response.body.data.recentActivity.every((entry) => typeof entry.id === "string")
  );
});

test("logout revokes issued tokens", async () => {
  const logout = await request(app)
    .post("/api/auth/logout")
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(logout.status, 200);

  const reused = await request(app)
    .get("/api/users/me")
    .set("Authorization", `Bearer ${primaryToken}`);

  assert.equal(reused.status, 401);
  assert.match(reused.body.message, /revoked|invalid/i);
});

test("resume can be deleted and is then no longer available", async () => {
  const login = await request(app).post("/api/auth/login").send({
    email: primary.email,
    password: primary.password,
  });
  const freshToken = login.body.data.token;

  const deleted = await request(app)
    .delete("/api/resumes/me")
    .set("Authorization", `Bearer ${freshToken}`);

  assert.equal(deleted.status, 200);

  const download = await request(app)
    .get("/api/resumes/me/file")
    .set("Authorization", `Bearer ${freshToken}`);

  assert.equal(download.status, 404);
});

function startFixtureServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function loginFreshToken() {
  const login = await request(app).post("/api/auth/login").send({
    email: primary.email,
    password: primary.password,
  });
  assert.equal(login.status, 200);
  return login.body.data.token;
}

test("multi-source discovery isolates a failing source", async () => {
  const token = await loginFreshToken();
  const originalFetch = global.fetch;
  clearJobsCache();

  global.fetch = async (input) => {
    const url = String(input);

    if (url.includes("remotive.com")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          jobs: [
            {
              id: 555001,
              title: "Multi Source Intern",
              company_name: "Isolation Co",
              description: "<p>Work on Node.js and PostgreSQL services.</p>",
              candidate_required_location: "Remote",
              job_type: "internship",
              url: "https://remotive.example/jobs/555001",
              publication_date: "2026-10-01T00:00:00Z",
            },
          ],
        }),
      };
    }

    return {
      ok: false,
      status: 503,
      headers: { get: () => null },
      json: async () => ({ error: "down" }),
    };
  };

  try {
    const response = await request(app)
      .get("/api/jobs/discover?sources=remotive,jobicy&search=multi-source&limit=5")
      .set("Authorization", `Bearer ${token}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.source, "multi");
    assert.equal(response.body.data.jobs.length, 1);
    assert.equal(response.body.data.jobs[0].company, "Isolation Co");
    assert.equal(response.body.meta.provider, "multi");

    const statuses = Object.fromEntries(
      response.body.data.sources.map((entry) => [entry.source, entry.status])
    );
    assert.equal(statuses.remotive, "ok");
    assert.equal(statuses.jobicy, "failed");
    assert.equal(response.body.data.errors.length, 1);
    assert.equal(response.body.data.errors[0].source, "jobicy");

    const supported = response.body.data.availableSources.map(
      (entry) => entry.name
    );
    for (const name of [
      "remotive",
      "jobicy",
      "arbeitnow",
      "greenhouse",
      "lever",
      "ashby",
      "remoteok",
    ]) {
      assert.ok(supported.includes(name), `${name} should be advertised`);
    }
  } finally {
    global.fetch = originalFetch;
    clearJobsCache();
  }
});

test("discovery applies location filters and validates filter values", async () => {
  const token = await loginFreshToken();
  const originalFetch = global.fetch;
  clearJobsCache();

  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      jobs: [
        {
          id: 988001,
          title: "Backend Intern",
          company_name: "Berlin Co",
          description: "<p>Node.js and MongoDB services.</p>",
          candidate_required_location: "Berlin, Germany",
          job_type: "internship",
          url: "https://live.example/jobs/988001",
          publication_date: "2026-10-01T00:00:00Z",
        },
      ],
    }),
  });

  try {
    const filtered = await request(app)
      .get("/api/jobs/discover?location=india&limit=5")
      .set("Authorization", `Bearer ${token}`);

    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.data.jobs.length, 0);
    assert.equal(filtered.body.data.filters.location, "india");

    const badType = await request(app)
      .get("/api/jobs/discover?jobType=nonsense")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(badType.status, 400);
    assert.equal(badType.body.code, "VALIDATION_ERROR");

    const badRemote = await request(app)
      .get("/api/jobs/discover?remote=maybe")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(badRemote.status, 400);
    assert.equal(badRemote.body.code, "VALIDATION_ERROR");
  } finally {
    global.fetch = originalFetch;
    clearJobsCache();
  }
});

test("a job can be imported from a non-Remotive source", async () => {
  const token = await loginFreshToken();
  const originalFetch = global.fetch;
  clearJobsCache();

  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      jobs: [
        {
          id: 777001,
          jobTitle: "Data Platform Intern",
          companyName: "Jobicy Co",
          jobDescription: "<p>Build Python data pipelines with Pandas.</p>",
          jobGeo: "Anywhere",
          jobType: ["internship"],
          url: "https://jobicy.example/jobs/777001",
          pubDate: "2026-10-05T00:00:00Z",
        },
      ],
    }),
  });

  try {
    const imported = await request(app)
      .post("/api/jobs/import")
      .set("Authorization", `Bearer ${token}`)
      .send({ source: "jobicy", externalId: "777001" });

    assert.equal(imported.status, 201);
    assert.equal(imported.body.data.created, true);
    assert.equal(imported.body.data.job.source, "jobicy");
    assert.equal(imported.body.data.job.location, "Remote");
    assert.equal(imported.body.data.job.applicationStatus, "saved");

    const again = await request(app)
      .post("/api/jobs/import")
      .set("Authorization", `Bearer ${token}`)
      .send({ source: "jobicy", externalId: "777001" });

    assert.equal(again.status, 200);
    assert.equal(again.body.data.created, false);
  } finally {
    global.fetch = originalFetch;
    clearJobsCache();
  }
});

test("URL import returns a draft and only saves when asked", async () => {
  const token = await loginFreshToken();
  const description =
    "Build and operate Node.js services backed by PostgreSQL. You will pair with senior engineers, write tests, review code, and ship small features every week. This internship runs for six months with a mentor.";

  const fixture = await startFixtureServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head>
      <title>Platform Intern | Acme</title>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Platform Engineering Intern",
        "description": "${description}",
        "employmentType": "INTERN",
        "datePosted": "2026-10-02",
        "hiringOrganization": { "name": "Acme Systems" },
        "jobLocation": {
          "@type": "Place",
          "address": { "addressLocality": "Pune", "addressCountry": "IN" }
        },
        "url": "https://acme.example/jobs/platform-intern",
        "identifier": { "value": "acme-platform-1" }
      }
      </script></head><body><h1>Platform Engineering Intern</h1></body></html>`);
  });

  try {
    const draft = await request(app)
      .post("/api/jobs/import-url")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: `${fixture.baseUrl}/jobs/platform-intern` });

    assert.equal(draft.status, 200);
    assert.equal(draft.body.data.extracted, true);
    assert.equal(draft.body.data.saved, false);
    assert.equal(draft.body.data.jobSaved, null);
    assert.equal(draft.body.data.platform.automaticIntegration, false);
    assert.equal(draft.body.data.job.title, "Platform Engineering Intern");
    assert.equal(draft.body.data.job.company, "Acme Systems");
    assert.equal(draft.body.data.job.source, "url");
    assert.equal(draft.body.data.job.jobType, "internship");
    assert.ok(draft.body.data.job.skills.includes("Node.js"));

    const saved = await request(app)
      .post("/api/jobs/import-url")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: `${fixture.baseUrl}/jobs/platform-intern`, save: true });

    assert.equal(saved.status, 201);
    assert.equal(saved.body.data.saved, true);
    assert.equal(saved.body.data.created, true);
    assert.equal(saved.body.data.jobSaved.source, "url");
    assert.equal(saved.body.data.jobSaved.applicationStatus, "saved");

    const duplicate = await request(app)
      .post("/api/jobs/import-url")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: `${fixture.baseUrl}/jobs/platform-intern`, save: true });

    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.data.created, false);

    const list = await request(app)
      .get("/api/jobs?source=url")
      .set("Authorization", `Bearer ${token}`);

    assert.equal(list.status, 200);
    assert.equal(list.body.meta.total, 1);
  } finally {
    await fixture.close();
  }
});

test("URL import blocks local and non-http destinations", async () => {
  const token = await loginFreshToken();

  // Loopback and private ranges are covered by unit tests with the default
  // guard; this test proves the endpoint refuses reserved hosts and schemes.
  for (const url of [
    "https://localhost/jobs/1",
    "https://metadata.google.internal/latest/meta-data/",
    "https://printer.local/jobs/1",
    "https://user:pass@example.com/jobs/1",
    "file:///etc/passwd",
    "ftp://example.com/jobs/1",
  ]) {
    const response = await request(app)
      .post("/api/jobs/import-url")
      .set("Authorization", `Bearer ${token}`)
      .send({ url });

    assert.equal(response.status, 400, `${url} should be blocked`);
    assert.equal(response.body.code, "URL_BLOCKED");
  }
});
