const BASE = "http://localhost:5000/api";
const EMAIL = "demo-tester-20261023@example.com";
const PASSWORD = "DemoPass!2026x";

let token = "";
let step = 0;
const results = [];

async function api(name, method, path, body, expect) {
  step += 1;
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const raw = Buffer.from(await res.arrayBuffer());
  let json = {};
  try { json = JSON.parse(raw.toString("utf8")); } catch {}
  const ok = expect ? expect.includes(res.status) : res.ok;
  results.push(`${ok ? "PASS" : "FAIL"} #${step} ${name}: HTTP ${res.status} (expected ${expect || "2xx"})${ok ? "" : " -> " + JSON.stringify(json).slice(0, 300)}`);
  return { res, status: res.status, json, raw, ok };
}

// 1. Unauthenticated access is rejected
await api("no-token /users/me", "GET", "/users/me", null, [401]);

// 2. Register
const reg = await api("register", "POST", "/auth/register", {
  name: "Demo Tester (test data)",
  email: EMAIL,
  password: PASSWORD,
}, [201, 409]);
if (!reg.ok) { console.log(results.join("\n")); process.exit(1); }
if (reg.status === 409) {
  results.push("INFO register returned 409: account already exists in this throwaway test DB (re-run tolerance); logging in instead");
  const li = await api("login (existing account)", "POST", "/auth/login", { email: EMAIL, password: PASSWORD }, [200]);
  token = li.json.data.token;
} else {
  token = reg.json.data.token;
}

// 3. Login (fresh token)
const login = await api("login", "POST", "/auth/login", { email: EMAIL, password: PASSWORD }, [200]);
token = login.json.data.token;

// 4. Profile
const prof = await api("profile update", "PATCH", "/users/me", {
  name: "Demo Tester (test data)",
  profile: {
    phone: "555-0100",
    headline: "Backend Engineering Intern (test data)",
    summary: "Node.js developer focused on REST APIs, MongoDB, and automated testing. Building reliable backend systems.",
    location: "Bengaluru, India",
    linkedinUrl: "https://www.linkedin.com/in/demo-tester-example",
    githubUrl: "https://github.com/demo-tester-example",
    portfolioUrl: "https://demo-tester.example.dev",
    skills: ["JavaScript", "Node.js", "MongoDB", "Express", "Docker"],
    preferredRoles: ["Backend Engineer", "Software Engineering Intern"],
    preferredLocations: ["Remote", "Bengaluru"],
    education: [{ institution: "Example Institute of Technology", degree: "B.Tech", field: "Computer Science", startYear: 2022, endYear: 2026 }],
    experience: [{ company: "Campus Labs", title: "Backend Intern", startDate: "2025", endDate: "2026", current: true, description: "Built Express APIs and MongoDB models." }],
    answerBank: [
      { question: "Why do you want this role?", answer: "The backend scope matches the systems I have built (test data).", approved: true },
      { question: "What are your salary expectations?", answer: "Prefer to discuss later (draft only).", approved: false },
    ],
    workAuthorization: { status: "citizen", requiresSponsorship: false },
  },
}, [200]);
const completeness = prof.json?.data?.user?.profileCompleteness;
results.push(`INFO profile completeness: ${completeness?.percent}% (missing: ${JSON.stringify(completeness?.missing)})`);

// 5. Resume upload (multipart PDF generated below by pdfkit)
import { createRequire } from "node:module";
const requireFromServer = createRequire(new URL("./server/package.json", import.meta.url));
const PDFDocument = requireFromServer("pdfkit");
const pdfText = `Demo Tester (test data)
Backend Engineering Intern (test data)
Email: ${EMAIL} | Phone: 555-0100 | Bengaluru, India
LinkedIn: https://www.linkedin.com/in/demo-tester-example
GitHub: https://github.com/demo-tester-example
SKILLS: JavaScript, Node.js, MongoDB, Express, Docker
EXPERIENCE
Campus Labs - Backend Intern (2025-2026)
Built Express APIs and MongoDB models.
EDUCATION
Example Institute of Technology - B.Tech Computer Science (2022-2026)
PROJECTS
Internship Tracker: REST API with Express and MongoDB.`;
const pdf = await new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: 40 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  doc.on("end", () => resolve(Buffer.concat(chunks)));
  doc.on("error", reject);
  doc.fontSize(11).text(pdfText);
  doc.end();
});
const form = new FormData();
form.append("resume", new Blob([pdf], { type: "application/pdf" }), "demo-tester-resume-test.pdf");
const up = await api("resume upload", "POST", "/resumes", form, [200, 201]);
const resumeId = up.json?.data?.resume?.id;
results.push(`INFO resume id: ${resumeId}, parsed name: ${up.json?.data?.resume?.parsed?.name ?? "(n/a)"}`);

// 6. Live job discovery (real public providers, read-only)
const disc = await api("job discovery (live providers)", "GET", "/jobs/discover?search=nodejs&limit=5", null, [200]);
const src = disc.json?.data?.sources ?? [];
results.push(`INFO discovery: ${disc.json?.data?.jobs?.length ?? 0} jobs; sources: ${src.map((s) => `${s.source}=${s.status}${s.error ? `(${String(s.error).slice(0, 40)})` : ""}`).join(", ")}`);

// 7. Manual job create (tracks an application)
const job = await api("job create", "POST", "/jobs", {
  title: "Backend Engineering Intern",
  company: "Acme Systems (demo)",
  description: "Build REST APIs with Node.js, Express, and MongoDB. Work with Docker and AWS. 1+ years experience with JavaScript.",
  skills: ["JavaScript", "Node.js", "Express", "MongoDB", "Docker"],
  location: "Remote",
  jobType: "internship",
  remote: true,
  applicationUrl: "https://acme.example/careers/backend-intern",
  postedAt: "2026-09-01T00:00:00.000Z",
}, [201, 409]);
const jobId = job.json?.data?.job?.id ?? job.json?.errors?.jobId;
if (job.status === 409) results.push("INFO job create returned 409 (re-run tolerance); using existing job id from the conflict body");
results.push(`INFO job id: ${jobId}, status: ${job.json?.data?.job?.applicationStatus}`);

// duplicate rejected
await api("duplicate job rejected", "POST", "/jobs", {
  title: "Backend Engineering Intern", company: "Acme Systems (demo)",
  description: "dup", skills: [], applicationUrl: "https://acme.example/careers/backend-intern",
}, [400, 409]);

// 8. Find the application for this job
const apps = await api("list applications", "GET", "/applications", null, [200]);
const application = (apps.json?.data?.applications ?? []).find((a) => a.job?.id === jobId);
results.push(`INFO application id: ${application?.id ?? "NOT FOUND"} status: ${application?.status ?? "?"}`);
if (!application) { console.log(results.join("\n")); process.exit(1); }

// 9. Cover letter
await api("cover letter save", "PATCH", `/applications/${application.id}`, {
  coverLetter: {
    subject: "Application for Backend Engineering Intern",
    body: "Dear Hiring Manager,\n\nThis is test data for a local demo. My experience is limited to the verified profile entries.",
  },
}, [200]);

// 10. Tailored resume generate -> download -> approve
const gen = await api("tailored resume generate", "POST", "/tailored-resumes", { jobId }, [201]);
const tr = gen.json?.data?.tailoredResume ?? gen.json?.data?.tailored?.resume ?? gen.json?.data;
results.push(`INFO tailored resume id: ${tr?.id}, revision ${tr?.revision}, status ${tr?.status}; diff.skills.added=${JSON.stringify(tr?.diff?.skills?.added ?? [])}`);
const dl = await api("tailored PDF download", "GET", `/tailored-resumes/${tr.id}/download/pdf`, null, [200]);
const buf = dl.raw;
results.push(`INFO PDF: ${buf.length} bytes, signature ${buf.subarray(0, 5).toString()}`);
const appr = await api("tailored approve", "POST", `/tailored-resumes/${tr.id}/approve`, { approved: true }, [200]);
results.push(`INFO approved revision status: ${appr.json?.data?.tailoredResume?.status}`);

// 11. Readiness (shape: data.readiness.{ready,status,blocking,checks,adapter})
const ready = await api("readiness", "GET", `/applications/${application.id}/readiness`, null, [200]);
const rd = ready.json?.data?.readiness ?? {};
const failedChecks = (rd.checks ?? []).filter((c) => c.status === "fail").map((c) => c.id);
results.push(`INFO readiness: ready=${rd.ready}, status=${rd.status}, blocking=${JSON.stringify(rd.blocking)}, failedChecks=${JSON.stringify(failedChecks)}, adapter=${rd.adapter?.key}`);

// 12b. Plan field mapping for a job whose URL points at a real supported portal
const job2 = await api("job create (real Greenhouse URL)", "POST", "/jobs", {
  title: "Forward Deployed Software Engineer, Internship",
  company: "Greenhouse Demo Co",
  description: "Test data job used to verify adapter-backed plan field mapping.",
  skills: ["JavaScript"],
  location: "Remote",
  jobType: "internship",
  remote: true,
  applicationUrl: "https://job-boards.greenhouse.io/cloudflare/jobs/7695702",
}, [201, 409]);
const jobId2 = job2.json?.data?.job?.id ?? job2.json?.errors?.jobId;
const apps2 = await api("list applications (2)", "GET", "/applications", null, [200]);
const app2 = (apps2.json?.data?.applications ?? []).find((a) => a.job?.id === jobId2);
if (app2) {
  const plan2 = await api("autofill plan (real URL)", "GET", `/applications/${app2.id}/autofill-plan`, null, [200]);
  const pl2 = plan2.json?.data?.plan ?? plan2.json?.data;
  results.push(`INFO plan (real URL): adapter=${pl2?.adapter?.key}, canAutofill=${pl2?.canAutofill}, fields=${pl2?.fields?.length}, sample=${JSON.stringify((pl2?.fields ?? []).slice(0, 3).map((f) => f.canonical))}`);
}
const run = await api("autofill run recorded", "POST", `/applications/${application.id}/autofill-runs`, {
  adapter: "workday",
  status: "needs_review",
  pageUrl: "https://acme.example/careers/backend-intern",
  filledFields: [{ canonical: "email", label: "Email", selector: "#email" }],
  missingFields: [{ canonical: "githubUrl", label: "GitHub URL", reason: "field_not_found" }],
  validationErrors: [],
  unsupportedControls: [],
  blockedBy: [],
  resumeUploaded: { format: "pdf", fileName: "demo-tester-resume-test.pdf" },
  coverLetterFilled: true,
  answersFilled: [],
  answersNotFilled: [],
  finalSubmissionControls: ["Submit application"],
  botProtection: { detected: false, visibleChallenge: false, kinds: [] },
  submitted: false,
  notes: "Local demo run against a test form. Nothing submitted.",
}, [201]);
const runList = await api("autofill run list", "GET", `/applications/${application.id}/autofill-runs`, null, [200]);
results.push(`INFO stored runs: ${runList.json?.data?.runs?.length ?? runList.json?.data?.length ?? "?"}, all submitted=false: ${(runList.json?.data?.runs ?? []).every((r) => r.submitted === false)}`);

await api("run claiming submitted=true is rejected", "POST", `/applications/${application.id}/autofill-runs`, { submitted: true, status: "completed" }, [400]);
await api("submit without confirmation is rejected", "POST", `/applications/${application.id}/submit`, { approved: true, confirmation: false }, [400]);

// 14. Ownership isolation: second account
const reg2 = await api("second account register", "POST", "/auth/register", {
  name: "Other Tester (test data)", email: "demo-other-20261023@example.com", password: "OtherPass!2026x",
}, [201, 409]);
let token2 = reg2.res.status === 201 ? reg2.json.data.token : null;
if (reg2.res.status === 409) {
  const li2 = await api("second account login", "POST", "/auth/login", { email: "demo-other-20261023@example.com", password: "OtherPass!2026x" }, [200]);
  token2 = li2.json.data.token;
}
const saved = token; token = token2;
const cross1 = await api("other account cannot read application", "GET", `/applications/${application.id}/readiness`, null, [401, 403, 404]);
const cross2 = await api("other account cannot download tailored resume", "GET", `/tailored-resumes/${tr.id}/download/pdf`, null, [401, 403, 404]);
const cross3 = await api("other account cannot read resume file", "GET", "/resumes/me/file", null, [404]);
token = saved;
results.push(`INFO cross-account responses: readiness=${cross1.res.status}, download=${cross2.res.status}, resumeFile=${cross3.res.status}`);

// 15. Explicit manual submit (approved + confirmation) records the submission
const sub = await api("manual submit with confirmation", "POST", `/applications/${application.id}/submit`, { approved: true, confirmation: true, method: "manual" }, [200]);
results.push(`INFO application status after submit: ${sub.json?.data?.application?.status ?? sub.json?.data?.status}, submittedAt: ${!!(sub.json?.data?.application?.submittedAt ?? sub.json?.data?.submittedAt)}`);

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(failed.length ? `\n${failed.length} FAILURES` : "\nALL E2E STEPS PASSED");
process.exit(failed.length ? 1 : 0);
