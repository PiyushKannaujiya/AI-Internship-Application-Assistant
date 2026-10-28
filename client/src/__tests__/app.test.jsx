import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import App from "../App.jsx";

const user = {
  id: "user-1",
  name: "Asha Verma",
  email: "asha@example.com",
  profile: {
    headline: "Backend Engineering Intern",
    summary: "Node.js developer focused on APIs.",
    location: "Bengaluru",
    skills: ["JavaScript", "Node.js", "MongoDB"],
    preferredRoles: ["Backend Engineer"],
    preferredLocations: ["Remote"],
    education: [],
    experience: [],
    jobPreferences: { jobTypes: [], remoteOnly: false },
  },
  profileCompleteness: { percent: 82, missing: [] },
  hasResume: true,
};

const job = {
  id: "job-1",
  title: "Backend Engineering Intern",
  company: "Acme Systems",
  description:
    "Build REST APIs with Node.js and MongoDB. 1+ years experience with JavaScript.",
  skills: ["Node.js", "MongoDB", "Docker"],
  location: "Remote",
  jobType: "internship",
  remote: true,
  source: "manual",
  applicationUrl: "https://acme.example/jobs/1",
  postedAt: "2026-09-01T00:00:00.000Z",
  createdAt: "2026-09-02T00:00:00.000Z",
  applicationId: "app-1",
  applicationStatus: "saved",
};

const application = {
  id: "app-1",
  status: "saved",
  notes: "",
  coverLetter: null,
  statusHistory: [{ status: "saved", at: "2026-09-02T00:00:00.000Z" }],
  submittedAt: null,
  submissionMethod: "none",
  updatedAt: "2026-09-02T00:00:00.000Z",
  job,
};

const match = {
  score: 84,
  method: "heuristic",
  matchedSkills: ["Node.js", "MongoDB"],
  missingSkills: ["Docker"],
  userSkills: ["JavaScript", "Node.js", "MongoDB"],
  components: { skills: 80, experience: 90, role: 75, location: 100 },
  experience: { userYears: 2, requiredYears: 1 },
  weights: { skills: 0.55, experience: 0.2, role: 0.15, location: 0.1 },
  reasons: [
    "You match 2 of 3 identified job skills.",
    "Your experience meets the requirement.",
    "Your preferred roles overlap with this job.",
    "This is a remote role.",
  ],
  suggestions: [
    {
      title: "Address the skill gaps",
      detail: "Add evidence for Docker only if you genuinely have it.",
    },
  ],
};

const dashboard = {
  stats: {
    savedJobs: 2,
    applications: 1,
    active: 1,
    submitted: 0,
    interviews: 0,
    offers: 0,
    rejections: 0,
    totalTracked: 3,
  },
  statusBreakdown: [
    { status: "saved", count: 2 },
    { status: "planned", count: 1 },
    { status: "in_progress", count: 0 },
    { status: "submitted", count: 0 },
    { status: "interview", count: 0 },
    { status: "rejected", count: 0 },
    { status: "offer", count: 0 },
  ],
  recentActivity: [
    {
      id: "activity-1",
      message: "Saved Backend Engineering Intern at Acme Systems",
      createdAt: new Date().toISOString(),
    },
  ],
  recentApplications: [],
  recommendedJobs: [],
  profileCompleteness: { percent: 82, missing: [] },
  resume: {
    id: "resume-1",
    originalName: "asha-resume.pdf",
    uploadedAt: new Date().toISOString(),
    skills: 8,
  },
  ai: { configured: false, provider: "template", model: null },
  recommendationNote: "Add or import jobs to receive recommendations.",
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
  };
}

function mockApi(handlers) {
  global.fetch = vi.fn(async (input, init = {}) => {
    const url = String(input);
    const method = (init.method || "GET").toUpperCase();
    const key = `${method} ${url.replace("http://localhost:5000/api", "")}`;

    for (const [pattern, handler] of handlers) {
      if (key.startsWith(pattern)) return handler(key, init);
    }

    throw new Error(`Unhandled API request: ${key}`);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
});

describe("authentication", () => {
  test("redirects unauthenticated users to login", async () => {
    window.history.pushState({}, "", "/dashboard");

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /sign in to your workspace/i })
    ).toBeInTheDocument();
  });

  test("shows client-side validation errors before calling the API", async () => {
    window.history.pushState({}, "", "/login");
    mockApi([]);
    const browser = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { name: /sign in to your workspace/i });

    await browser.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("logs in and renders real dashboard data from the API", async () => {
    window.history.pushState({}, "", "/login");
    mockApi([
      [
        "POST /auth/login",
        async () =>
          jsonResponse({
            success: true,
            data: { user, token: "test-token" },
          }),
      ],
      ["GET /dashboard", async () => jsonResponse({ success: true, data: dashboard })],
    ]);
    const browser = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { name: /sign in to your workspace/i });

    await browser.type(screen.getByLabelText("Email address"), user.email);
    await browser.type(screen.getByLabelText("Password"), "StrongPass123");
    await browser.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(
      await screen.findByRole("heading", { name: /good to see you, asha/i })
    ).toBeInTheDocument();
    expect(screen.getByText("Saved jobs")).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(window.localStorage.getItem("applypilot.token")).toBe("test-token");
  });
});

describe("job workspace", () => {
  test("restores a session and shows the jobs empty state", async () => {
    window.localStorage.setItem("applypilot.token", "test-token");
    window.history.pushState({}, "", "/jobs");
    mockApi([
      ["GET /auth/me", async () => jsonResponse({ success: true, data: { user } })],
      [
        "GET /jobs?",
        async () =>
          jsonResponse({
            success: true,
            data: { jobs: [] },
            meta: { page: 1, limit: 12, total: 0, totalPages: 0 },
          }),
      ],
    ]);

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /find roles worth your time/i })
    ).toBeInTheDocument();
    expect(await screen.findByText("No saved jobs yet")).toBeInTheDocument();
  });

  test("generates a labeled draft and gates submission behind explicit approval", async () => {
    window.localStorage.setItem("applypilot.token", "test-token");
    window.history.pushState({}, "", "/jobs/job-1");

    mockApi([
      ["GET /auth/me", async () => jsonResponse({ success: true, data: { user } })],
      [
        "GET /jobs/job-1",
        async () =>
          jsonResponse({
            success: true,
            data: { job, application, match, resumeUsed: true },
          }),
      ],
      [
        "POST /ai/cover-letter",
        async () =>
          jsonResponse({
            success: true,
            data: {
              coverLetter: {
                subject: "Application for Backend Engineering Intern at Acme Systems",
                body: "Dear Hiring Manager,\n\nI am applying for the role.",
                provider: "template",
                notice: "AI is not configured. This is a deterministic template.",
              },
              match,
              ai: { configured: false, provider: "template", model: null },
              applicationId: "app-1",
            },
          }),
      ],
      [
        "GET /applications/app-1/preview",
        async () =>
          jsonResponse({
            success: true,
            data: {
              application,
              job: {
                id: job.id,
                title: job.title,
                company: job.company,
                applicationUrl: job.applicationUrl,
                location: job.location,
              },
              prefill: {
                fields: [
                  { key: "fullName", label: "Full name", value: "Asha Verma" },
                  { key: "email", label: "Email", value: "asha@example.com" },
                ],
                coverLetter: "Dear Hiring Manager,\n\nI am applying for the role.",
              },
              workflow: {
                automatedSubmission: false,
                requiresExplicitApproval: true,
                instructions: [
                  "Review every prefilled value for accuracy.",
                  "Open the employer's application page in your browser.",
                ],
                limitations: [
                  "This app does not bypass CAPTCHAs, MFA, or site terms.",
                ],
              },
            },
          }),
      ],
    ]);

    const browser = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /backend engineering intern/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/84/)).toBeInTheDocument();

    await browser.click(screen.getByRole("button", { name: /generate draft/i }));

    expect(
      await screen.findByText(/AI is not configured. This is a deterministic template./i)
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Dear Hiring Manager/)).toBeInTheDocument();

    await browser.click(
      screen.getByRole("button", { name: /open application preview/i })
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/verified prefill values/i)).toBeInTheDocument();

    const recordButton = screen.getByRole("button", {
      name: /i submitted this/i,
    });
    expect(recordButton).toBeDisabled();

    await browser.click(screen.getByRole("checkbox"));
    expect(recordButton).toBeEnabled();
    expect(screen.getByText(/does not bypass CAPTCHAs/i)).toBeInTheDocument();
  });

  test("shows the Ready for Review checklist and blocks autofill until a resume is approved", async () => {
    window.localStorage.setItem("applypilot.token", "test-token");
    window.history.pushState({}, "", "/jobs/job-1");

    const readiness = {
      applicationId: "app-1",
      jobId: "job-1",
      ready: false,
      status: "needs_attention",
      blocking: ["approved_resume", "screening_answers"],
      applicationStatus: "saved",
      statusPreserved: true,
      requirements: {
        coverLetter: "required",
        questions: [
          "Why do you want this role?",
          "Describe a production API you built.",
        ],
      },
      adapter: {
        key: "greenhouse",
        name: "Greenhouse",
        supported: true,
        autofillSupported: true,
        resumeUploadSupported: true,
        requiresLogin: false,
        notes: "Greenhouse job boards render a single public application form.",
        unsupportedReason: "",
      },
      approvedResume: null,
      checks: [
        {
          id: "application_url",
          label: "Application page",
          status: "pass",
          required: true,
          detail: "Greenhouse application page is reachable by URL.",
          fix: null,
        },
        {
          id: "approved_resume",
          label: "Approved tailored resume",
          status: "fail",
          required: true,
          detail: "No tailored resume exists for this job yet.",
          fix: {
            label: "Generate a tailored resume",
            href: "/jobs/job-1/tailored",
          },
        },
        {
          id: "final_submission_guard",
          label: "You submit, not the app",
          status: "pass",
          required: true,
          detail:
            "Autofill stops before the final control. You must click Apply, Submit, or Send yourself.",
          fix: null,
        },
      ],
      missingProfile: [
        { field: "phone", label: "Phone number", href: "/profile" },
      ],
      missingAnswers: [
        {
          question: "Describe a production API you built.",
          reason: "no_approved_answer",
        },
      ],
      summary: { total: 3, passed: 2, warnings: 0, failures: 1 },
      submission: {
        automatic: false,
        requiresHumanClick: true,
        note: "This readiness report never submits an application.",
      },
    };

    const plan = {
      schemaVersion: 1,
      canAutofill: false,
      blockers: [
        {
          code: "no_approved_resume",
          detail: "Approve a tailored resume for this job before running autofill.",
        },
      ],
      fields: [],
      adapter: { key: "greenhouse", autofillSupported: true },
      safety: { autoSubmit: false, finalSubmissionRequiresHuman: true },
    };

    let planRequests = 0;
    const requirementPayloads = [];

    mockApi([
      ["GET /auth/me", async () => jsonResponse({ success: true, data: { user } })],
      [
        "GET /jobs/job-1",
        async () =>
          jsonResponse({
            success: true,
            data: { job, application, match, resumeUsed: true },
          }),
      ],
      [
        "GET /applications/app-1/readiness",
        async () => jsonResponse({ success: true, data: { readiness } }),
      ],
      [
        "POST /applications/app-1/readiness",
        async (_key, init) => {
          requirementPayloads.push(JSON.parse(init.body));
          return jsonResponse({ success: true, data: { readiness } });
        },
      ],
      [
        "GET /applications/app-1/autofill-plan",
        async () => {
          planRequests += 1;
          return jsonResponse({ success: true, data: { plan } });
        },
      ],
    ]);

    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = vi.fn(() => "blob:applypilot-plan");
    URL.revokeObjectURL = vi.fn();
    // jsdom logs a navigation warning for real anchor clicks; the download
    // itself is verified through createObjectURL and the reported notice.
    HTMLAnchorElement.prototype.click = vi.fn();

    try {
      const browser = userEvent.setup();
      render(<App />);

      expect(
        await screen.findByRole("heading", { name: /ready for review/i })
      ).toBeInTheDocument();
      expect(
        await screen.findByText(/no tailored resume exists for this job yet/i)
      ).toBeInTheDocument();
      expect(screen.getByText("2 blockers")).toBeInTheDocument();
      expect(
        screen.getByText(/describe a production api you built/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/phone number/i)).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /generate a tailored resume/i })
      ).toBeInTheDocument();

      // The checklist is explicit that the human performs the final click, and
      // there is no submission control on the page or in the helper.
      expect(screen.getByText(/you click the final button/i)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /submit application|apply now/i })
      ).not.toBeInTheDocument();

      await browser.click(
        screen.getByRole("button", { name: /download autofill plan/i })
      );

      await waitFor(() => expect(planRequests).toBe(1));
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(
        await screen.findByText(/plan downloaded, but autofill is blocked/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/approve a tailored resume for this job/i)
      ).toBeInTheDocument();

      // Portal requirements are explicit: the user marks a cover letter as
      // required and supplies screening questions before re-checking.
      await browser.click(screen.getByText(/^portal requirements$/i));
      await browser.selectOptions(
        screen.getByLabelText(/^cover letter$/i),
        "required"
      );
      await browser.type(
        screen.getByLabelText(/screening questions/i),
        "Why do you want this role?"
      );
      await browser.click(
        screen.getByRole("button", { name: /re-evaluate checklist/i })
      );

      await waitFor(() => expect(requirementPayloads).toHaveLength(1));
      expect(requirementPayloads[0].requirements.coverLetter).toBe("required");
      expect(requirementPayloads[0].requirements.questions).toEqual([
        "Why do you want this role?",
      ]);
      expect(
        await screen.findByText(/checklist re-evaluated/i)
      ).toBeInTheDocument();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      HTMLAnchorElement.prototype.click = originalAnchorClick;
    }
  });

  test("discovers live jobs with location, work-mode, and job-type filters", async () => {
    window.localStorage.setItem("applypilot.token", "test-token");
    window.history.pushState({}, "", "/jobs");

    const discoveredJob = {
      externalId: "555",
      title: "Backend Intern",
      company: "Acme India",
      description: "Build Node.js services and MongoDB models.",
      skills: ["Node.js", "MongoDB"],
      location: "Bengaluru, India",
      jobType: "internship",
      remote: true,
      source: "remoteok",
      applicationUrl: "https://acme.example/careers/555",
      postedAt: "2026-10-15T00:00:00.000Z",
    };

    mockApi([
      ["GET /auth/me", async () => jsonResponse({ success: true, data: { user } })],
      [
        "GET /jobs?",
        async () =>
          jsonResponse({
            success: true,
            data: { jobs: [] },
            meta: { page: 1, limit: 12, total: 0, totalPages: 0 },
          }),
      ],
      [
        "GET /jobs/discover",
        async () =>
          jsonResponse({
            success: true,
            data: {
              jobs: [discoveredJob],
              total: 1,
              searchedAt: new Date().toISOString(),
              source: "multi",
              sources: [
                {
                  source: "remotive",
                  label: "Remotive",
                  target: null,
                  status: "ok",
                  count: 1,
                  durationMs: 5,
                },
              ],
              errors: [],
              attribution:
                "Remote job listings provided by Remote OK (https://remoteok.com)",
              filters: {
                location: "india",
                remote: true,
                jobType: "internship",
              },
              availableSources: [],
            },
          }),
      ],
    ]);

    const browser = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /find roles worth your time/i })
    ).toBeInTheDocument();

    await browser.click(screen.getByRole("tab", { name: /discover/i }));

    // The field defaults to India now; typing replaces it after a clear so
    // this still proves the value is sent as typed.
    const locationField = screen.getByLabelText("Filter live jobs by location");
    await browser.clear(locationField);
    await browser.type(locationField, "india");
    await browser.selectOptions(
      screen.getByLabelText("Filter live jobs by work mode"),
      "true"
    );
    await browser.selectOptions(
      screen.getByLabelText("Filter live jobs by job type"),
      "internship"
    );
    await browser.click(screen.getByRole("button", { name: /search live/i }));

    // The API receives every filter the user set.
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/jobs\/discover\?.*location=india/),
      expect.anything()
    );
    const discoverCall = global.fetch.mock.calls.find(([url]) =>
      String(url).includes("/jobs/discover")
    );
    expect(discoverCall).toBeTruthy();
    const discoverUrl = String(discoverCall[0]);
    expect(discoverUrl).toContain("remote=true");
    expect(discoverUrl).toContain("jobType=internship");

    expect(await screen.findByText(/1 live result/i)).toBeInTheDocument();
    expect(
      screen.getByText(/location india · remote only · internship/i)
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: /backend intern/i })
    ).toBeInTheDocument();

    // Remote OK attribution is rendered as a real follow link, per its API terms.
    const attributionLink = screen.getByRole("link", {
      name: "https://remoteok.com",
    });
    expect(attributionLink.getAttribute("rel")).toContain("follow");
  });
});

describe("profile extensions", () => {
  test("saves projects, certifications, achievements, approved answers, and work authorization", async () => {
    window.localStorage.setItem("applypilot.token", "test-token");
    window.history.pushState({}, "", "/profile");

    mockApi([
      ["GET /auth/me", async () => jsonResponse({ success: true, data: { user } })],
      [
        "PATCH /users/me",
        async () => jsonResponse({ success: true, data: { user } }),
      ],
    ]);

    const browser = userEvent.setup({ delay: null });
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /build a profile worth reusing/i })
    ).toBeInTheDocument();

    await browser.click(screen.getByRole("button", { name: /add project/i }));
    await browser.type(screen.getByLabelText("Project name"), "Internship Tracker");
    await browser.type(
      screen.getByLabelText(/^Technologies/),
      "Node.js, MongoDB"
    );
    await browser.click(
      screen.getByRole("button", { name: /add accomplishment/i })
    );
    await browser.type(
      screen.getByLabelText("Accomplishment 1"),
      "Cut wait time by 35%"
    );
    await browser.click(screen.getByRole("checkbox", { name: /i can verify this/i }));

    await browser.click(
      screen.getByRole("button", { name: /add certification/i })
    );
    await browser.type(
      screen.getByLabelText("Certification name"),
      "AWS Certified Cloud Practitioner"
    );
    await browser.type(screen.getByLabelText("Issuer"), "Amazon Web Services");

    await browser.click(
      screen.getByRole("button", { name: /add achievement/i })
    );
    await browser.type(
      screen.getByLabelText("Achievement title"),
      "Smart India Hackathon winner"
    );

    await browser.click(screen.getByRole("button", { name: /add answer/i }));
    await browser.type(
      screen.getByLabelText("Question"),
      "Why do you want this role?"
    );
    await browser.type(
      screen.getByLabelText("Answer"),
      "The backend scope matches what I have built."
    );
    await browser.click(
      screen.getByRole("checkbox", {
        name: /approved for reuse in application previews/i,
      })
    );

    await browser.selectOptions(
      screen.getByLabelText("Work authorization status"),
      "work_visa"
    );
    await browser.click(
      screen.getByRole("checkbox", { name: /i will need visa sponsorship/i })
    );
    await browser.click(screen.getByRole("checkbox", { name: "Hybrid" }));

    await browser.click(screen.getByRole("button", { name: /save profile/i }));

    expect(
      await screen.findByText(/profile saved\. matching and drafts/i)
    ).toBeInTheDocument();

    const patchCall = global.fetch.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/users/me") && init?.method === "PATCH"
    );
    expect(patchCall).toBeTruthy();
    const payload = JSON.parse(patchCall[1].body).profile;

    expect(payload.projects[0]).toMatchObject({
      name: "Internship Tracker",
      technologies: ["Node.js", "MongoDB"],
      accomplishments: [{ text: "Cut wait time by 35%", verified: true }],
    });
    expect(payload.certifications[0].name).toBe(
      "AWS Certified Cloud Practitioner"
    );
    expect(payload.achievements[0].title).toBe("Smart India Hackathon winner");
    expect(payload.answerBank).toEqual([
      {
        question: "Why do you want this role?",
        answer: "The backend scope matches what I have built.",
        approved: true,
      },
    ]);
    expect(payload.workAuthorization).toMatchObject({
      status: "work_visa",
      requiresSponsorship: true,
    });
    expect(payload.jobPreferences.workModes).toEqual(["hybrid"]);
  }, 15000);
});

describe("tailored resumes", () => {
  test("generates, shows differences, edits, and approves a job-specific resume", async () => {
    window.localStorage.setItem("applypilot.token", "test-token");
    window.history.pushState({}, "", "/jobs/job-1/tailored");

    let versions = [];
    let detail = null;
    const patches = [];
    let approveCalls = 0;

    function makeDetail() {
      return {
        id: "tr-1",
        jobId: "job-1",
        baseResumeId: "resume-1",
        revision: 1,
        status: "draft",
        approvedAt: null,
        provider: "heuristic",
        notice:
          "This summary was built deterministically from your verified profile.",
        content: {
          headline: "Backend Engineering Intern",
          summary:
            "Tailored for Backend Engineering Intern at Acme Systems, highlighting Node.js.\n\nNode.js developer focused on APIs.",
          skills: ["Node.js", "MongoDB"],
          experience: [],
          projects: [
            {
              name: "Campus Queue Service",
              description: "Queueing service for lab equipment.",
              technologies: ["Node.js", "MongoDB"],
              accomplishments: [
                { text: "Cut average wait time by 35%", verified: true },
              ],
            },
          ],
          education: [],
          certifications: [],
          achievements: [],
        },
        changes: { omitted: ["Unverified claim"] },
        diff: {
          summary: { changed: true, original: "Node.js developer", tailored: "Tailored summary" },
          skills: { reordered: true, added: [], removed: [] },
          experience: { reordered: false },
          projects: [
            {
              name: "Campus Queue Service",
              omitted: ["Handled 1,200 requests per day"],
            },
          ],
          education: { originalCount: 0, tailoredCount: 0 },
          certifications: { originalCount: 0, tailoredCount: 0 },
          achievements: { originalCount: 0, tailoredCount: 0 },
        },
        files: [
          { format: "pdf", size: 2048, fileName: "tailored.pdf" },
          { format: "docx", size: 4096, fileName: "tailored.docx" },
        ],
        downloads: {
          pdf: "/api/tailored-resumes/tr-1/download/pdf",
          docx: "/api/tailored-resumes/tr-1/download/docx",
        },
      };
    }

    mockApi([
      ["GET /auth/me", async () => jsonResponse({ success: true, data: { user } })],
      [
        "GET /jobs/job-1",
        async () =>
          jsonResponse({
            success: true,
            data: { job, application, match, resumeUsed: true },
          }),
      ],
      [
        "POST /tailored-resumes/tr-1/approve",
        async () => {
          approveCalls += 1;
          detail = { ...detail, status: "approved", approvedAt: new Date().toISOString() };
          versions = versions.map((version) => ({
            ...version,
            status: "approved",
            approvedAt: detail.approvedAt,
          }));
          return jsonResponse({
            success: true,
            data: { tailoredResume: detail },
          });
        },
      ],
      [
        "PATCH /tailored-resumes/tr-1",
        async (_key, init) => {
          const body = JSON.parse(init.body);
          patches.push(body);
          detail = {
            ...detail,
            content: { ...detail.content, ...body.content },
          };
          return jsonResponse({
            success: true,
            data: { tailoredResume: detail },
          });
        },
      ],
      [
        "GET /tailored-resumes/tr-1",
        async () =>
          jsonResponse({ success: true, data: { tailoredResume: detail } }),
      ],
      [
        "GET /tailored-resumes?jobId=job-1",
        async () =>
          jsonResponse({ success: true, data: { tailoredResumes: versions } }),
      ],
      [
        "POST /tailored-resumes",
        async () => {
          detail = makeDetail();
          versions = [
            {
              id: detail.id,
              revision: 1,
              status: "draft",
              approvedAt: null,
              isLatestRevision: true,
              createdAt: "2026-10-21T00:00:00.000Z",
              files: detail.files,
            },
          ];
          return jsonResponse(
            { success: true, data: { tailoredResume: detail } },
            201
          );
        },
      ],
    ]);

    const browser = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /^tailored resume$/i })
    ).toBeInTheDocument();
    expect(await screen.findByText(/no tailored resume yet/i)).toBeInTheDocument();

    await browser.click(
      screen.getByRole("button", { name: /generate tailored resume/i })
    );

    expect(
      await screen.findByRole("heading", { name: /revision 1/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/not marked verified/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /download pdf/i })
    ).toBeInTheDocument();

    const summary = screen.getByLabelText("Summary");
    await browser.clear(summary);
    await browser.type(summary, "Edited tailored summary.");
    await browser.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].content.summary).toBe("Edited tailored summary.");
    expect(patches[0].content.skills).toEqual(["Node.js", "MongoDB"]);

    const approvalBox = screen.getByRole("checkbox", {
      name: /confirm this resume is accurate/i,
    });
    const approveButton = screen.getByRole("button", {
      name: /approve for application use/i,
    });
    expect(approveButton).toBeDisabled();

    await browser.click(approvalBox);
    await browser.click(approveButton);

    await waitFor(() => expect(approveCalls).toBe(1));
    expect(
      await screen.findByText(/now offered in the application preview/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/included in the application preview/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save changes/i })
    ).toBeDisabled();
  }, 15000);
});

describe("resume extraction review", () => {
  const review = {
    resume: {
      id: "resume-1",
      originalName: "asha-resume.docx",
      uploadedAt: "2026-10-01T00:00:00.000Z",
      wordCount: 140,
    },
    proposals: {
      contact: {
        email: "asha@example.com",
        phone: "+91 98765 43210",
        linkedinUrl: "https://linkedin.com/in/ashaverma",
        githubUrl: "https://github.com/ashaverma",
        portfolioUrl: "",
      },
      headline: "Senior Backend Developer",
      skills: ["JavaScript", "Node.js", "Express"],
      projects: [
        {
          name: "Internship Tracker",
          description: "Tracks applications with Express and MongoDB.",
          technologies: ["Node.js", "Express", "MongoDB"],
          accomplishments: ["Cut duplicate entries by 40%"],
        },
      ],
      certifications: [
        { name: "AWS Certified Cloud Practitioner", issuer: "AWS", issueDate: "2025" },
      ],
      achievements: ["Winner, Smart India Hackathon 2025"],
    },
    comparison: {
      fields: [],
      skills: { current: ["JavaScript"], proposed: ["JavaScript", "Node.js"], additions: ["Node.js"] },
      newEntries: { projects: 1, certifications: 1, achievements: 1, skills: 1 },
    },
    conflicts: [
      {
        field: "headline",
        label: "headline",
        current: "Backend Engineering Intern",
        proposed: "Senior Backend Developer",
        status: "conflict",
      },
    ],
    notes: ["Extraction is heuristic and can be wrong."],
  };

  test("shows conflicts, requires a review, and protects verified values by default", async () => {
    window.localStorage.setItem("applypilot.token", "test-token");
    window.history.pushState({}, "", "/resume");

    const applyPayloads = [];
    const resume = {
      id: "resume-1",
      originalName: "asha-resume.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 2048,
      uploadedAt: "2026-10-01T00:00:00.000Z",
      parsed: {
        skills: ["JavaScript", "Node.js"],
        educationMentions: [],
        wordCount: 140,
        extractionWarning: "",
      },
      text: "Asha Verma Senior Backend Developer",
    };

    mockApi([
      ["GET /auth/me", async () => jsonResponse({ success: true, data: { user } })],
      [
        "GET /resumes/me/extraction",
        async () => jsonResponse({ success: true, data: { review } }),
      ],
      [
        "GET /resumes/me",
        async () => jsonResponse({ success: true, data: { resume } }),
      ],
      [
        "POST /resumes/me/extraction/apply",
        async (_key, init) => {
          applyPayloads.push(JSON.parse(init.body));
          return jsonResponse({
            success: true,
            data: {
              user,
              applied: {
                fields: ["headline"],
                skills: ["Express"],
                projects: ["Internship Tracker"],
                certifications: [],
                achievements: [],
                overwriteVerified: false,
              },
              skipped: [
                {
                  field: "headline",
                  reason: "existing_value_protected",
                  current: "Backend Engineering Intern",
                  proposed: "Senior Backend Developer",
                },
              ],
              review,
            },
          });
        },
      ],
    ]);

    const browser = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /review extracted profile data/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /profile has .*Backend Engineering Intern.*resume says .*Senior Backend Developer/i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/replace existing verified values/i)
    ).not.toBeChecked();

    // Parsed entries are editable before they reach the profile.
    const projectName = screen.getByLabelText("Extracted project name 1");
    await browser.clear(projectName);
    await browser.type(projectName, "Internship Tracker v2");

    await browser.click(
      screen.getByRole("button", { name: /apply reviewed data/i })
    );

    await waitFor(() => expect(applyPayloads).toHaveLength(1));
    expect(applyPayloads[0].reviewed).toBe(true);
    expect(applyPayloads[0].overwriteVerified).toBe(false);
    expect(applyPayloads[0].fields.headline).toBe("Senior Backend Developer");
    expect(applyPayloads[0].projects[0].name).toBe("Internship Tracker v2");
    expect(applyPayloads[0].projects[0].accomplishments[0].verified).toBe(false);
    expect(applyPayloads[0].certifications).toHaveLength(1);
    expect(applyPayloads[0].achievements).toHaveLength(1);

    expect(
      await screen.findByText(/kept from your verified profile/i)
    ).toBeInTheDocument();

    // Explicit opt-in is the only way to replace an existing verified value.
    await browser.click(screen.getByLabelText(/replace existing verified values/i));
    await browser.click(
      screen.getByRole("button", { name: /apply reviewed data/i })
    );
    await waitFor(() => expect(applyPayloads).toHaveLength(2));
    expect(applyPayloads[1].overwriteVerified).toBe(true);
  });
});
