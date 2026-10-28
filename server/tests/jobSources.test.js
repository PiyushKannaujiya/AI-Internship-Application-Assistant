import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  availableSources,
  clearJobsCache,
  discoverJobs,
  findDiscoveredJob,
} from "../src/services/jobSources/index.js";
import { SourceError } from "../src/services/jobSources/httpClient.js";
import {
  matchesLocation,
  normalizeJobType,
} from "../src/services/jobSources/normalize.js";
import * as remotive from "../src/services/jobSources/remotive.js";
import * as jobicy from "../src/services/jobSources/jobicy.js";
import * as arbeitnow from "../src/services/jobSources/arbeitnow.js";
import * as greenhouse from "../src/services/jobSources/greenhouse.js";
import * as lever from "../src/services/jobSources/lever.js";
import * as ashby from "../src/services/jobSources/ashby.js";
import * as remoteok from "../src/services/jobSources/remoteok.js";
import * as adzuna from "../src/services/jobSources/adzuna.js";
import * as workable from "../src/services/jobSources/workable.js";
import * as smartrecruiters from "../src/services/jobSources/smartrecruiters.js";
import {
  listSearchShortcuts,
} from "../src/services/jobSources/shortcuts.js";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => payload,
  };
}

function installFetch(routes) {
  const original = global.fetch;
  const calls = [];

  global.fetch = async (input, options = {}) => {
    const url = String(input);
    calls.push(url);

    for (const [needle, handler] of Object.entries(routes)) {
      if (!url.includes(needle)) continue;
      if (typeof handler === "function") return handler(url, options);
      return jsonResponse(handler);
    }

    return jsonResponse({ error: "not mocked" }, 404);
  };

  return {
    calls,
    restore() {
      global.fetch = original;
    },
  };
}

afterEach(() => {
  clearJobsCache();
});

test("job type normalization covers provider variants", () => {
  assert.equal(normalizeJobType("internship"), "internship");
  assert.equal(normalizeJobType("FULL_TIME"), "full-time");
  assert.equal(normalizeJobType(["full-time"]), "full-time");
  assert.equal(normalizeJobType("Full-time, Internship"), "internship");
  assert.equal(normalizeJobType("freelance"), "contract");
  assert.equal(normalizeJobType(""), "other");
  assert.equal(normalizeJobType("nonsense"), "other");
});

test("registry exposes every implemented source and its target requirement", () => {
  const sources = availableSources();
  const names = sources.map((source) => source.name).sort();

  assert.deepEqual(names, [
    "adzuna",
    "arbeitnow",
    "ashby",
    "greenhouse",
    "jobicy",
    "lever",
    "remoteok",
    "remotive",
    "smartrecruiters",
    "workable",
  ]);

  const byName = Object.fromEntries(sources.map((entry) => [entry.name, entry]));
  assert.equal(byName.remotive.requiresTarget, false);
  assert.equal(byName.jobicy.requiresTarget, false);
  assert.equal(byName.arbeitnow.requiresTarget, false);
  assert.equal(byName.greenhouse.requiresTarget, true);
  assert.equal(byName.lever.requiresTarget, true);
  assert.equal(byName.ashby.requiresTarget, true);
  assert.equal(byName.remoteok.requiresTarget, false);
  assert.equal(byName.adzuna.requiresTarget, false);
  assert.equal(byName.adzuna.requiresKey, true);
  assert.equal(byName.workable.requiresTarget, true);
  assert.equal(byName.smartrecruiters.requiresTarget, true);
});

test("adzuna adapter maps the official API response and drops unusable rows", async () => {
  const mock = installFetch({
    "api.adzuna.com": (url, options) => {
      assert.ok(url.includes("/v1/api/jobs/in/search/1"));
      assert.ok(
        url.includes("app_id=test-id") && url.includes("app_key=test-key")
      );
      assert.ok(url.includes("max_days_old=30"));
      assert.ok(url.includes("what=backend+intern"));
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          count: 2,
          results: [
            {
              id: 515001,
              title: "Backend Intern",
              description: "Build Node.js services with MongoDB at an Indian fintech.",
              redirect_url: "https://jobs.example.co.in/515001",
              company: { display_name: "Fintech Labs" },
              location: { display_name: "Bengaluru", area: ["Bengaluru", "Karnataka"] },
              contract_time: "full_time",
              contract_type: "permanent",
              created: "2026-10-20T10:00:00Z",
              category: { label: "IT Jobs" },
              salary_min: 2000000,
              salary_max: 3000000,
              salary_currency: "INR",
            },
            {
              id: 515002,
              title: "Broken row",
              description: "text",
              redirect_url: "https://x.example/",
            },
          ],
        }),
      };
    },
  });

  try {
    const jobs = await adzuna.fetchJobs({
      search: "backend intern",
      limit: 20,
      timeoutMs: 1000,
      config: { appId: "test-id", appKey: "test-key", country: "in" },
    });

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].source, "adzuna");
    assert.equal(jobs[0].externalId, "515001");
    assert.equal(jobs[0].title, "Backend Intern");
    assert.equal(jobs[0].company, "Fintech Labs");
    assert.equal(jobs[0].location, "Bengaluru");
    assert.equal(jobs[0].jobType, "full-time");
    assert.equal(jobs[0].remote, false);
    assert.equal(jobs[0].applicationUrl, "https://jobs.example.co.in/515001");
    assert.ok(jobs[0].salary.includes("\u20b9"));
    assert.equal(mock.calls.length, 1);
  } finally {
    mock.restore();
  }
});

test("adzuna adapter reports missing credentials with a stable code", async () => {
  await assert.rejects(
    adzuna.fetchJobs({ config: { appId: "", appKey: "" } }),
    (error) =>
      error instanceof SourceError && error.code === "not_configured"
  );
});

test("adzuna rejects a malformed country as setup corruption, not an outage", async () => {
  await assert.rejects(
    adzuna.fetchJobs({
      config: { appId: "a", appKey: "b", country: "INDIA" },
    }),
    (error) =>
      error instanceof SourceError && error.code === "not_configured"
  );

  await assert.rejects(
    adzuna.fetchJobs({
      config: { appId: "a", appKey: "b", country: "!!" },
    }),
    (error) => error.code === "not_configured"
  );
});

test("adzuna paginates to collect more listings than the free-tier page size", async () => {
  const row = (id) => ({
    id,
    title: `SDE intern position ${id}`,
    description: `Node.js and MongoDB internship ${id} at an Indian startup.`,
    redirect_url: `https://jobs.example.co.in/${id}`,
    company: { display_name: `Startup ${id}` },
    location: { display_name: id % 2 ? "Bengaluru" : "Pune" },
    contract_time: "full_time",
    contract_type: "permanent",
    created: "2026-10-21T00:00:00Z",
  });

  const pagesRequested = [];
  const mock = installFetch({
    "api.adzuna.com": (url) => {
      const page = Number(url.match(/\/search\/(\d+)/)?.[1] || 1);
      pagesRequested.push(page);
      const pageSize = page === 1 ? 50 : 10; // second page ends the feed
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          count: 60,
          results: Array.from({ length: pageSize }, (_, i) => row(page * 1000 + i)),
        }),
      };
    },
  });

  try {
    const jobs = await adzuna.fetchJobs({
      search: "intern",
      limit: 60,
      timeoutMs: 1000,
      config: { appId: "t", appKey: "t", country: "in" },
    });

    assert.equal(jobs.length, 60);
    assert.deepEqual(pagesRequested, [1, 2]);
    const ids = new Set(jobs.map((job) => job.externalId));
    assert.equal(ids.size, 60, "no duplicate ids across pages");
  } finally {
    mock.restore();
  }
});

test("unfiltered discovery surfaces Indian listings first without dropping others", async () => {
  const mock = installFetch({
    "remotive.com": {
      jobs: [
        {
          id: 950,
          title: "Platform Intern",
          company_name: "Berlin Systems",
          description: "<p>Go services on Kubernetes.</p>",
          candidate_required_location: "Berlin, Germany",
          job_type: "internship",
          url: "https://remotive.example/jobs/950",
        },
        {
          id: 951,
          title: "SDE Intern",
          company_name: "Bengaluru Labs",
          description: "<p>Node.js and MongoDB services.</p>",
          candidate_required_location: "Bengaluru, India",
          job_type: "internship",
          url: "https://remotive.example/jobs/951",
        },
      ],
    },
  });

  try {
    const result = await discoverJobs({ sources: "remotive", limit: 5 });

    assert.equal(result.filters.location, null);
    assert.deepEqual(
      result.jobs.map((job) => job.company),
      ["Bengaluru Labs", "Berlin Systems"]
    );
    assert.equal(result.total, 2, "nothing was dropped by the reorder");
  } finally {
    mock.restore();
  }
});

test("adzuna without credentials is skipped while healthy sources still return", async () => {
  const mock = installFetch({
    "remotive.com": {
      jobs: [
        {
          id: 900,
          title: "Node.js Intern",
          company_name: "Remote Co",
          description: "Work Express.js REST APIs end to end.",
          candidate_required_location: "Remote",
          job_type: "internship",
          url: "https://remotive.example/jobs/900",
        },
      ],
    },
  });

  try {
    const result = await discoverJobs({
      sources: "remotive,adzuna",
      search: "intern",
      limit: 5,
      timeoutMs: 1000,
    });

    const statuses = Object.fromEntries(
      result.sources.map((entry) => [entry.source, entry])
    );
    assert.equal(statuses.remotive.status, "ok");
    assert.equal(statuses.remotive.count, 1);
    assert.equal(statuses.adzuna.status, "skipped");
    assert.equal(statuses.adzuna.error.code, "not_configured");

    // Skipped-but-healthy discovery must not be treated as a total outage.
    assert.equal(result.total, 1);
  } finally {
    mock.restore();
  }
});

test("search shortcuts cover the Indian platforms with verified URL shapes", () => {
  const shortcuts = listSearchShortcuts({
    search: "backend intern",
    location: "India",
    jobType: "internship",
    remote: true,
  });

  const byId = Object.fromEntries(shortcuts.map((s) => [s.id, s]));
  for (const entry of shortcuts) {
    assert.equal(entry.kind, "search-shortcut");
    assert.equal(entry.automaticIntegration, false);
    assert.ok(entry.url.startsWith("https://"));
    assert.ok(entry.note.length > 20);
  }

  const urls = Object.fromEntries(
    shortcuts.map((entry) => [entry.id, entry.url])
  );

  assert.equal(
    urls.linkedin,
    "https://www.linkedin.com/jobs/search/?keywords=backend%20intern&location=India&f_JT=I&f_WT=2"
  );
  assert.equal(
    urls.internshala,
    "https://internshala.com/internships/work-from-home-internships/"
  );
  assert.equal(
    urls.naukri,
    "https://www.naukri.com/backend-intern-internship-jobs"
  );
  assert.equal(
    urls.wellfound,
    "https://wellfound.com/jobs?query=backend%20intern"
  );
  assert.equal(urls.unstop, "https://unstop.com/internships?search=backend%20intern");
  assert.equal(
    urls.cutshort,
    "https://cutshort.io/jobs?query=backend%20intern"
  );
  assert.equal(
    urls.foundit,
    "https://www.foundit.in/srp/results?query=backend%20intern/jobtype/internship"
  );
});

test("internshala shortcut falls back to verified listing pages, not fake query URLs", () => {
  const shortcuts = listSearchShortcuts({
    search: "backend intern",
    location: "Bengaluru",
    jobType: "internship",
  });
  const internshala = shortcuts.find((entry) => entry.id === "internshala");
  assert.equal(
    internshala.url,
    "https://internshala.com/internships/internship-in-bangalore/"
  );

  const fullTime = listSearchShortcuts({
    search: "backend",
    jobType: "full-time",
  }).find((entry) => entry.id === "internshala");
  assert.equal(fullTime.url, "https://internshala.com/jobs/");

  const recent = listSearchShortcuts({}).find((entry) => entry.id === "internshala");
  assert.equal(recent.url, "https://internshala.com/internships/");
});

test("discover returns shortcuts beside live results and never merges them", async () => {
  const mock = installFetch({
    "remotive.com": {
      jobs: [
        {
          id: 910,
          title: "React Intern",
          company_name: "Web Co",
          description: "Ship React dashboards with our product team.",
          candidate_required_location: "Remote",
          job_type: "internship",
          url: "https://remotive.example/jobs/910",
        },
      ],
    },
  });

  try {
    const result = await discoverJobs({
      sources: "remotive",
      search: "react intern",
      limit: 5,
      timeoutMs: 1000,
    });

    assert.ok(Array.isArray(result.shortcuts));
    assert.ok(result.shortcuts.length >= 7);
    for (const shortcut of result.shortcuts) {
      assert.ok(!result.jobs.some((job) => job.source === shortcut.id));
    }
    assert.equal(
      result.filters.location,
      null,
      "no filter was requested in this call"
    );
  } finally {
    mock.restore();
  }
});

test("remotive adapter normalizes and drops unusable listings", async () => {
  const mock = installFetch({
    "remotive.com": {
      jobs: [
        {
          id: 101,
          title: "Backend Intern",
          company_name: "Acme Systems",
          description: "<p>Build Node.js services and MongoDB models.</p>",
          candidate_required_location: "Remote",
          job_type: "internship",
          url: "https://remotive.example/jobs/101",
          publication_date: "2026-10-01T00:00:00Z",
          category: "Software Development",
          salary: "$40k",
        },
        { id: 102, title: "", company_name: "Broken" },
        { title: "No id", company_name: "Broken", description: "long enough text" },
        {
          id: 103,
          title: "Bad url",
          company_name: "Broken",
          description: "Description long enough here",
          url: "javascript:alert(1)",
        },
      ],
    },
  });

  try {
    const jobs = await remotive.fetchJobs({ limit: 10 });

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].externalId, "101");
    assert.equal(jobs[0].source, "remotive");
    assert.equal(jobs[0].jobType, "internship");
    assert.equal(jobs[0].remote, true);
    assert.ok(jobs[0].skills.includes("Node.js"));
    assert.ok(jobs[0].skills.includes("MongoDB"));
    assert.equal(jobs[0].category, "Software Development");
  } finally {
    mock.restore();
  }
});

test("jobicy adapter normalizes arrays, geo, and salary", async () => {
  const mock = installFetch({
    "jobicy.com": {
      jobs: [
        {
          id: 202,
          jobTitle: "Data Science Intern",
          companyName: "Insight Co",
          jobDescription: "<p>Work with Python, Pandas, and scikit-learn.</p>",
          jobGeo: "Anywhere",
          jobType: ["full-time", "internship"],
          url: "https://jobicy.example/jobs/202",
          pubDate: "2026-09-15T00:00:00Z",
          annualSalaryMin: 30000,
          annualSalaryMax: 40000,
          salaryCurrency: "USD",
          jobIndustry: ["Data Science"],
        },
      ],
    },
  });

  try {
    const jobs = await jobicy.fetchJobs({ limit: 10 });

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].externalId, "202");
    assert.equal(jobs[0].location, "Remote");
    assert.equal(jobs[0].jobType, "internship");
    assert.equal(jobs[0].remote, true);
    assert.equal(jobs[0].salary, "USD 30000-40000");
    assert.equal(jobs[0].category, "Data Science");
    assert.ok(jobs[0].skills.includes("Python"));
  } finally {
    mock.restore();
  }
});

test("arbeitnow adapter keeps tags available for skill extraction", async () => {
  const mock = installFetch({
    "arbeitnow.com": {
      data: [
        {
          slug: "backend-intern-berlin",
          company_name: "Berlin Tech",
          title: "Backend Intern",
          description: "Join the platform team for six months.",
          remote: false,
          url: "https://arbeitnow.example/jobs/backend-intern-berlin",
          tags: ["Docker", "PostgreSQL"],
          job_types: ["internship"],
          location: "Berlin",
          created_at: 1758000000,
        },
      ],
    },
  });

  try {
    const jobs = await arbeitnow.fetchJobs({ limit: 10 });

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].externalId, "backend-intern-berlin");
    assert.equal(jobs[0].jobType, "internship");
    assert.equal(jobs[0].remote, false);
    assert.ok(jobs[0].skills.includes("Docker"));
    assert.ok(jobs[0].skills.includes("PostgreSQL"));
    assert.ok(jobs[0].postedAt instanceof Date);
  } finally {
    mock.restore();
  }
});

test("greenhouse adapter decodes escaped HTML and needs a board", async () => {
  const mock = installFetch({
    "boards-api.greenhouse.io": {
      jobs: [
        {
          id: 303,
          title: "Platform Engineering Intern",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/303",
          updated_at: "2026-10-02T00:00:00Z",
          content:
            "&lt;p&gt;Build &lt;strong&gt;Node.js&lt;/strong&gt; and PostgreSQL services.&lt;/p&gt;",
          location: { name: "Remote - Europe" },
          metadata: [{ name: "Employment Type", value: "Internship" }],
        },
      ],
    },
  });

  try {
    const jobs = await greenhouse.fetchJobs({ target: "acme", limit: 10 });

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].externalId, "acme:303");
    assert.equal(jobs[0].company, "Acme");
    assert.equal(jobs[0].jobType, "internship");
    assert.equal(jobs[0].remote, true);
    assert.match(jobs[0].description, /Node\.js/);
    assert.doesNotMatch(jobs[0].description, /&lt;/);

    await assert.rejects(
      () => greenhouse.fetchJobs({ target: "", limit: 10 }),
      (error) => error instanceof SourceError && error.code === "missing_target"
    );
  } finally {
    mock.restore();
  }
});

test("lever adapter maps categories and plain descriptions", async () => {
  const mock = installFetch({
    "api.lever.co": [
      {
        id: "lever-1",
        text: "Software Engineering Intern",
        hostedUrl: "https://jobs.lever.co/figma/lever-1",
        createdAt: 1758000000000,
        descriptionPlain: "Work on TypeScript and React components.",
        categories: {
          commitment: "Internship",
          location: "Remote",
          team: "Design Systems",
          department: "Engineering",
        },
      },
    ],
  });

  try {
    const jobs = await lever.fetchJobs({ target: "figma", limit: 10 });

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].externalId, "figma:lever-1");
    assert.equal(jobs[0].company, "Figma");
    assert.equal(jobs[0].jobType, "internship");
    assert.equal(jobs[0].remote, true);
    assert.equal(jobs[0].category, "Engineering");
    assert.ok(jobs[0].skills.includes("TypeScript"));
  } finally {
    mock.restore();
  }
});

test("ashby adapter reads compensation and remote flags", async () => {
  const mock = installFetch({
    "api.ashbyhq.com": {
      jobs: [
        {
          id: "ashby-1",
          title: "Machine Learning Intern",
          department: "Research",
          employmentType: "Internship",
          location: "Remote",
          isRemote: true,
          publishedAt: "2026-09-20T00:00:00Z",
          descriptionHtml: "<p>Train models with PyTorch.</p>",
          jobUrl: "https://jobs.ashbyhq.com/notion/ashby-1",
          compensation: { compensationTierSummary: "$45K – $55K" },
        },
      ],
    },
  });

  try {
    const jobs = await ashby.fetchJobs({ target: "notion", limit: 10 });

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].externalId, "notion:ashby-1");
    assert.equal(jobs[0].jobType, "internship");
    assert.equal(jobs[0].remote, true);
    assert.equal(jobs[0].salary, "$45K – $55K");
    assert.ok(jobs[0].skills.includes("PyTorch"));
  } finally {
    mock.restore();
  }
});

test("board adapters reject unexpected payloads instead of returning fake jobs", async () => {
  const mock = installFetch({
    "boards-api.greenhouse.io": { jobs: "nope" },
    "api.lever.co": { message: "rate limited" },
    "api.ashbyhq.com": { jobs: [{ title: "Missing id" }] },
  });

  try {
    await assert.rejects(
      () => greenhouse.fetchJobs({ target: "acme", limit: 5 }),
      (error) => error.code === "unexpected_payload"
    );
    await assert.rejects(
      () => lever.fetchJobs({ target: "acme", limit: 5 }),
      (error) => error.code === "unexpected_payload"
    );

    const ashbyJobs = await ashby.fetchJobs({ target: "acme", limit: 5 });
    assert.deepEqual(ashbyJobs, []);
  } finally {
    mock.restore();
  }
});

test("multi-source discovery merges and deduplicates the same listing", async () => {
  const mock = installFetch({
    "remotive.com": {
      jobs: [
        {
          id: 900,
          title: "Backend Intern",
          company_name: "Acme Systems",
          description: "<p>Build Node.js services with MongoDB.</p>",
          candidate_required_location: "Remote",
          job_type: "internship",
          url: "https://remotive.example/jobs/900",
          publication_date: "2026-10-01T00:00:00Z",
        },
      ],
    },
    "jobicy.com": {
      jobs: [
        {
          id: 901,
          jobTitle: "Backend Intern",
          companyName: "Acme Systems",
          jobDescription: "<p>The same role listed on another board.</p>",
          jobGeo: "Anywhere",
          jobType: ["internship"],
          url: "https://jobicy.example/jobs/901",
        },
      ],
    },
  });

  try {
    const result = await discoverJobs({
      sources: "remotive,jobicy",
      limit: 10,
    });

    assert.equal(result.source, "multi");
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].source, "remotive");
    assert.deepEqual(result.jobs[0].duplicateSources, ["jobicy"]);
    assert.equal(result.sources.length, 2);
    assert.ok(result.sources.every((source) => source.status === "ok"));
    assert.match(result.attribution, /Remotive/);
    assert.match(result.attribution, /Jobicy/);
    assert.ok(result.availableSources.length >= 6);
  } finally {
    mock.restore();
  }
});

test("merged results are interleaved across sources", async () => {
  const makeRemotive = (id, title) => ({
    id,
    title,
    company_name: `Company ${id}`,
    description: `<p>Node.js and MongoDB role number ${id}.</p>`,
    candidate_required_location: "Remote",
    job_type: "internship",
    url: `https://remotive.example/jobs/${id}`,
  });

  const mock = installFetch({
    "remotive.com": {
      jobs: [makeRemotive(1, "First Remotive"), makeRemotive(2, "Second Remotive")],
    },
    "jobicy.com": {
      jobs: [
        {
          id: 21,
          jobTitle: "First Jobicy",
          companyName: "Jobicy One",
          jobDescription: "<p>Python and Pandas analytics work.</p>",
          jobGeo: "Anywhere",
          jobType: ["internship"],
          url: "https://jobicy.example/jobs/21",
        },
        {
          id: 22,
          jobTitle: "Second Jobicy",
          companyName: "Jobicy Two",
          jobDescription: "<p>React and TypeScript interfaces.</p>",
          jobGeo: "Anywhere",
          jobType: ["internship"],
          url: "https://jobicy.example/jobs/22",
        },
      ],
    },
  });

  try {
    const result = await discoverJobs({
      sources: "remotive,jobicy",
      limit: 4,
    });

    assert.deepEqual(
      result.jobs.map((job) => job.source),
      ["remotive", "jobicy", "remotive", "jobicy"]
    );
  } finally {
    mock.restore();
  }
});

test("one failing source does not hide results from healthy sources", async () => {
  const mock = installFetch({
    "remotive.com": {
      jobs: [
        {
          id: 910,
          title: "Site Reliability Intern",
          company_name: "Resilient Co",
          description: "<p>Operate Docker and Kubernetes workloads.</p>",
          candidate_required_location: "Remote",
          job_type: "internship",
          url: "https://remotive.example/jobs/910",
        },
      ],
    },
    "jobicy.com": () => jsonResponse({ error: "boom" }, 500),
    "arbeitnow.com": () => {
      throw new Error("network down");
    },
  });

  try {
    const result = await discoverJobs({
      sources: "remotive,jobicy,arbeitnow",
      limit: 10,
    });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].company, "Resilient Co");

    const statuses = Object.fromEntries(
      result.sources.map((source) => [source.source, source.status])
    );
    assert.equal(statuses.remotive, "ok");
    assert.equal(statuses.jobicy, "failed");
    assert.equal(statuses.arbeitnow, "failed");

    assert.equal(result.errors.length, 2);
    assert.ok(result.errors.some((error) => error.code === "provider_error"));
    assert.ok(result.errors.some((error) => error.code === "unreachable"));
  } finally {
    mock.restore();
  }
});

test("a hanging source times out without blocking the others", async () => {
  const mock = installFetch({
    "remotive.com": {
      jobs: [
        {
          id: 920,
          title: "Backend Intern",
          company_name: "Timeout Co",
          description: "<p>Node.js and PostgreSQL services.</p>",
          candidate_required_location: "Remote",
          job_type: "internship",
          url: "https://remotive.example/jobs/920",
        },
      ],
    },
    "jobicy.com": (_url, options) =>
      new Promise((resolve, reject) => {
        // A ref'd timer keeps the event loop alive so the abort signal can
        // actually fire; it is cleared as soon as the signal aborts.
        const keepAlive = setTimeout(
          () => resolve(jsonResponse({ jobs: [] })),
          5000
        );

        options.signal.addEventListener("abort", () => {
          clearTimeout(keepAlive);
          const error = new Error("The operation was aborted due to timeout");
          error.name = "TimeoutError";
          reject(error);
        });
      }),
  });

  try {
    const result = await discoverJobs({
      sources: "remotive,jobicy",
      limit: 5,
      timeoutMs: 40,
    });

    assert.equal(result.jobs.length, 1);

    const jobicyStatus = result.sources.find(
      (source) => source.source === "jobicy"
    );
    assert.equal(jobicyStatus.status, "failed");
    assert.equal(jobicyStatus.error.code, "timeout");
  } finally {
    mock.restore();
  }
});

test("discovery returns 503 only when every requested source fails", async () => {
  const mock = installFetch({
    "remotive.com": () => {
      throw new Error("network down");
    },
    "jobicy.com": () => {
      throw new Error("network down");
    },
  });

  try {
    await assert.rejects(
      () => discoverJobs({ sources: "remotive,jobicy", limit: 5 }),
      (error) => {
        assert.equal(error.statusCode, 503);
        assert.equal(error.code, "SERVICE_UNAVAILABLE");
        assert.match(error.message, /unreachable|unavailable/i);
        assert.equal(error.details.sources.length, 2);
        return true;
      }
    );
  } finally {
    mock.restore();
  }
});

test("unknown sources and unconfigured boards are reported clearly", async () => {
  await assert.rejects(
    () => discoverJobs({ sources: "remotive,myspace", limit: 5 }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /Unknown job source: myspace/);
      return true;
    }
  );

  const mock = installFetch({
    "remotive.com": {
      jobs: [
        {
          id: 930,
          title: "Frontend Intern",
          company_name: "Boardless Co",
          description: "<p>Build React interfaces with TypeScript.</p>",
          candidate_required_location: "Remote",
          job_type: "internship",
          url: "https://remotive.example/jobs/930",
        },
      ],
    },
  });

  try {
    const result = await discoverJobs({
      sources: "remotive,greenhouse",
      limit: 5,
    });

    const greenhouseStatus = result.sources.find(
      (source) => source.source === "greenhouse"
    );
    assert.equal(greenhouseStatus.status, "skipped");
    assert.equal(greenhouseStatus.error.code, "no_targets_configured");
    assert.equal(result.jobs.length, 1);
  } finally {
    mock.restore();
  }

  await assert.rejects(
    () => discoverJobs({ sources: "greenhouse", limit: 5 }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /boards configured/i);
      return true;
    }
  );
});

test("configured boards are queried and merged", async () => {
  const mock = installFetch({
    "boards-api.greenhouse.io/v1/boards/acme": {
      jobs: [
        {
          id: 1,
          title: "Backend Intern",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
          content: "<p>Node.js services</p>",
          location: { name: "Bengaluru" },
        },
      ],
    },
    "api.lever.co/v0/postings/figma": [
      {
        id: "l1",
        text: "Design Intern",
        hostedUrl: "https://jobs.lever.co/figma/l1",
        descriptionPlain: "Work with Figma and CSS.",
        categories: { location: "Remote", commitment: "Internship" },
      },
    ],
  });

  try {
    const result = await discoverJobs({
      sources: "greenhouse,lever",
      boards: { greenhouse: "acme", lever: "figma" },
      limit: 10,
    });

    assert.equal(result.jobs.length, 2);
    assert.equal(result.source, "multi");
    assert.ok(
      result.jobs.some((job) => job.source === "greenhouse" && job.externalId === "acme:1")
    );
    assert.ok(
      result.jobs.some((job) => job.source === "lever" && job.externalId === "figma:l1")
    );
  } finally {
    mock.restore();
  }
});

test("search filters board results before merging", async () => {
  const mock = installFetch({
    "boards-api.greenhouse.io": {
      jobs: [
        {
          id: 11,
          title: "Backend Intern",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/11",
          content: "<p>Node.js services</p>",
          location: { name: "Remote" },
        },
        {
          id: 12,
          title: "Marketing Intern",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/12",
          content: "<p>Campaign planning and copywriting</p>",
          location: { name: "Remote" },
        },
      ],
    },
  });

  try {
    const result = await discoverJobs({
      sources: "greenhouse",
      boards: { greenhouse: "acme" },
      search: "backend",
      limit: 10,
    });

    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].title, "Backend Intern");
  } finally {
    mock.restore();
  }
});

test("board imports accept a prefixed or raw provider id", async () => {
  const mock = installFetch({
    "boards-api.greenhouse.io": {
      jobs: [
        {
          id: 4451,
          title: "Backend Intern",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/4451",
          content: "<p>Node.js services and PostgreSQL.</p>",
          location: { name: "Remote" },
        },
      ],
    },
  });

  try {
    const prefixed = await findDiscoveredJob({
      source: "greenhouse",
      externalId: "acme:4451",
    });
    assert.equal(prefixed.externalId, "acme:4451");

    const rawWithBoard = await findDiscoveredJob({
      source: "greenhouse",
      externalId: "4451",
      board: "acme",
    });
    assert.equal(rawWithBoard.externalId, "acme:4451");

    await assert.rejects(
      () =>
        findDiscoveredJob({
          source: "greenhouse",
          externalId: "9999",
          board: "acme",
        }),
      (error) => error.statusCode === 404
    );
  } finally {
    mock.restore();
  }
});

test("location filtering matches India by country, city, or state", () => {
  const job = (location) => ({ location });

  assert.equal(matchesLocation(job("Bengaluru, India"), ""), true);
  assert.equal(matchesLocation(job("Bengaluru, India"), "india"), true);
  assert.equal(matchesLocation(job("Hyderabad"), "India"), true);
  assert.equal(matchesLocation(job("Pune, Maharashtra"), "india"), true);
  assert.equal(matchesLocation(job("NCR"), "india"), true);
  assert.equal(matchesLocation(job("Berlin, Germany"), "india"), false);
  assert.equal(matchesLocation(job("Remote"), "india"), false);
  assert.equal(matchesLocation(job("Not specified"), "india"), false);
  assert.equal(matchesLocation(job("Berlin, Germany"), "berlin"), true);
  assert.equal(matchesLocation(job("Not specified"), ""), true);
});

test("discovery filters by location, remote flag, and job type", async () => {
  const mock = installFetch({
    "remotive.com": {
      jobs: [
        {
          id: 810,
          title: "Backend Intern",
          company_name: "Bengaluru Labs",
          description: "<p>Node.js and MongoDB services.</p>",
          candidate_required_location: "Bengaluru, India",
          job_type: "internship",
          url: "https://remotive.example/jobs/810",
        },
        {
          id: 811,
          title: "Backend Intern",
          company_name: "Berlin Systems",
          description: "<p>Node.js and MongoDB services in Europe.</p>",
          candidate_required_location: "Berlin, Germany",
          job_type: "internship",
          url: "https://remotive.example/jobs/811",
        },
      ],
    },
    "jobicy.com": {
      jobs: [
        {
          id: 812,
          jobTitle: "Sales Engineer",
          companyName: "German Sales",
          jobDescription: "<p>Sell developer tooling in Germany.</p>",
          jobGeo: "Germany",
          jobType: ["full-time"],
          url: "https://jobicy.example/jobs/812",
        },
      ],
    },
  });

  try {
    const india = await discoverJobs({
      sources: "remotive,jobicy",
      limit: 10,
      location: "india",
    });
    assert.deepEqual(
      india.jobs.map((job) => job.externalId),
      ["810"]
    );
    assert.equal(india.filters.location, "india");

    const onsite = await discoverJobs({
      sources: "remotive,jobicy",
      limit: 10,
      remote: "false",
    });
    assert.deepEqual(
      onsite.jobs.map((job) => job.externalId),
      ["812"]
    );
    assert.equal(onsite.filters.remote, false);

    const internships = await discoverJobs({
      sources: "remotive,jobicy",
      limit: 10,
      jobType: "internship",
    });
    assert.deepEqual(
      internships.jobs.map((job) => job.externalId).sort(),
      ["810", "811"]
    );

    const noMatches = await discoverJobs({
      sources: "remotive,jobicy",
      limit: 10,
      location: "india",
      jobType: "full-time",
    });
    assert.equal(noMatches.jobs.length, 0);
    assert.equal(noMatches.total, 0);
    assert.ok(noMatches.sources.every((source) => source.status === "ok"));
  } finally {
    mock.restore();
  }
});

test("remoteok adapter normalizes the public feed and skips the legal notice", async () => {
  const mock = installFetch({
    "remoteok.com": [
      {
        legal: "Terms: link back to Remote OK and mention it as the source.",
        last_updated: 1792483205,
      },
      {
        id: "555",
        slug: "remote-backend-intern-acme-555",
        position: "Backend Intern",
        company: "Acme",
        description: "<p>Build Node.js services and MongoDB models.</p>",
        apply_url: "https://acme.example/careers/555",
        url: "https://remoteok.com/remote-jobs/remote-backend-intern-acme-555",
        location: "",
        tags: ["node", "internship"],
        date: "2026-10-15T10:00:00+00:00",
        salary_min: 0,
        salary_max: 0,
      },
      {
        id: "556",
        slug: "remote-full-stack-engineer-beta-556",
        position: "Full Stack Engineer",
        company: "Beta",
        description: "<p>React and TypeScript product engineering.</p>",
        apply_url: "javascript:alert(1)",
        url: "https://remoteok.com/remote-jobs/remote-full-stack-engineer-beta-556",
        location: "Europe",
        tags: ["react"],
        date: "2026-10-14T10:00:00+00:00",
        salary_min: 10000,
        salary_max: 20000,
      },
      { position: "Ghost Role" },
    ],
  });

  try {
    const jobs = await remoteok.fetchJobs({ limit: 10 });
    assert.equal(jobs.length, 2);

    const first = jobs[0];
    assert.equal(first.externalId, "555");
    assert.equal(first.title, "Backend Intern");
    assert.equal(first.company, "Acme");
    assert.equal(first.applicationUrl, "https://acme.example/careers/555");
    assert.equal(first.location, "Remote");
    assert.equal(first.remote, true);
    assert.equal(first.jobType, "internship");
    assert.equal(first.category, "node, internship");

    // A broken apply_url must not throw the whole listing away.
    const second = jobs[1];
    assert.equal(
      second.applicationUrl,
      "https://remoteok.com/remote-jobs/remote-full-stack-engineer-beta-556"
    );
    assert.equal(second.jobType, "other");
    assert.equal(second.salary, "USD 10000-20000");

    const searched = await remoteok.fetchJobs({ limit: 10, search: "backend" });
    assert.equal(searched.length, 1);
    assert.equal(searched[0].externalId, "555");
  } finally {
    mock.restore();
  }
});

test("remoteok adapter reports an unexpected payload as a source error", async () => {
  const mock = installFetch({ "remoteok.com": { error: "maintenance" } });

  try {
    await assert.rejects(
      () => remoteok.fetchJobs({ limit: 5 }),
      (error) => {
        assert.equal(error.name, "SourceError");
        assert.equal(error.code, "unexpected_payload");
        return true;
      }
    );
  } finally {
    mock.restore();
  }
});

test("a Remote OK listing can be re-fetched and imported by id", async () => {
  const mock = installFetch({
    "remoteok.com": [
      { legal: "notice" },
      {
        id: "901",
        position: "Backend Intern",
        company: "Gamma",
        description: "<p>Node.js APIs with Express and MongoDB.</p>",
        url: "https://remoteok.com/remote-jobs/backend-intern-901",
        location: "India",
        tags: ["node"],
        date: "2026-10-18",
      },
    ],
  });

  try {
    const job = await findDiscoveredJob({
      source: "remoteok",
      externalId: "901",
    });
    assert.equal(job.company, "Gamma");
    assert.equal(job.location, "India");

    await assert.rejects(
      () => findDiscoveredJob({ source: "remoteok", externalId: "404" }),
      (error) => {
        assert.equal(error.statusCode, 404);
        return true;
      }
    );
  } finally {
    mock.restore();
  }
});

test("successful discovery is cached and can be cleared", async () => {
  const mock = installFetch({
    "remotive.com": {
      jobs: [
        {
          id: 940,
          title: "QA Intern",
          company_name: "Cache Co",
          description: "<p>Write Playwright tests for REST APIs.</p>",
          candidate_required_location: "Remote",
          job_type: "internship",
          url: "https://remotive.example/jobs/940",
        },
      ],
    },
  });

  try {
    const first = await discoverJobs({ limit: 5, search: "qa-cache-test" });
    assert.equal(first.cached, false);

    const second = await discoverJobs({ limit: 5, search: "qa-cache-test" });
    assert.equal(second.cached, true);
    assert.equal(mock.calls.length, 1);

    clearJobsCache();
    const third = await discoverJobs({ limit: 5, search: "qa-cache-test" });
    assert.equal(third.cached, false);
    assert.equal(mock.calls.length, 2);
  } finally {
    mock.restore();
    clearJobsCache();
  }
});

// Workable is read from its public, keyless jobs widget feed. These tests fix
// the mapping contract that was verified against live boards on 2026-10-25.
test("workable adapter maps the public widget feed and drops unusable rows", async () => {
  const mock = installFetch({
    "api/v1/widget/accounts/mercari-india": {
      jobs: [
        {
          title: "Backend Engineer",
          shortcode: "7E1007642A",
          code: "7E1007642A",
          url: "https://apply.workable.com/j/7E1007642A",
          employment_type: "Full-time",
          telecommuting: false,
          department: { name: "Engineering" },
          function: { name: "Software Engineering" },
          country: "India",
          city: "Bengaluru",
          locations: [
            {
              country: "India",
              countryCode: "IN",
              city: "Bengaluru",
              region: "Karnataka",
              hidden: false,
            },
          ],
          published_on: "2026-10-19",
          description: "<p>Build Node.js services for an Indian GCC.</p>",
        },
        {
          title: "Broken row keeps a title and description",
          description: "<p>A perfectly valid description that is long enough.</p>",
          url: "javascript:alert(1)",
          shortcode: "",
        },
      ],
    },
  });

  try {
    const jobs = await workable.fetchJobs({ target: "mercari-india", limit: 10 });

    assert.equal(jobs.length, 1);
    const job = jobs[0];
    assert.equal(job.source, "workable");
    assert.equal(job.externalId, "mercari-india:7E1007642A");
    assert.equal(job.company, "Mercari India");
    assert.equal(job.location, "Bengaluru, Karnataka, India");
    assert.equal(job.jobType, "full-time");
    assert.equal(job.remote, false);
    assert.equal(job.category, "Engineering");
    assert.equal(
      job.applicationUrl,
      "https://apply.workable.com/j/7E1007642A"
    );
    assert.match(job.description, /Build Node\.js services/);
    assert.ok(
      job.postedAt instanceof Date &&
        job.postedAt.toISOString().startsWith("2026-10-19")
    );

    // The feed URL must carry the details flag so descriptions arrive in the
    // same single request.
    assert.equal(mock.calls.length, 1);
    assert.ok(mock.calls[0].includes("?details=true"));
  } finally {
    mock.restore();
  }
});

test("workable adapter rejects missing targets and unexpected payloads", async () => {
  await assert.rejects(
    () => workable.fetchJobs({}),
    (error) => error.code === "missing_target"
  );

  const mock = installFetch({
    "api/v1/widget/accounts/bad-account": { detail: "no jobs key" },
  });

  try {
    await assert.rejects(
      () => workable.fetchJobs({ target: "bad-account" }),
      (error) => error.code === "unexpected_payload"
    );
  } finally {
    mock.restore();
  }
});

test("workable falls back to the account-prefixed job URL when the feed omits one", async () => {
  const mock = installFetch({
    "api/v1/widget/accounts/exponent-energy": {
      jobs: [
        {
          title: "Application Support Engineer",
          shortcode: "ABC123",
          employment_type: "Full-time",
          locations: [{ country: "India", city: "Chennai" }],
          created_at: "2026-10-20T10:00:00.000Z",
          description: "Support robotics deployments across Indian sites.",
        },
      ],
    },
  });

  try {
    const jobs = await workable.fetchJobs({
      target: "exponent-energy",
      limit: 5,
    });
    assert.equal(jobs.length, 1);
    assert.equal(
      jobs[0].applicationUrl,
      "https://apply.workable.com/exponent-energy/j/ABC123/"
    );
    // created_at backs published_on when the feed omits the publish date.
    assert.ok(jobs[0].postedAt.toISOString().startsWith("2026-10-20"));
  } finally {
    mock.restore();
  }
});

// The SmartRecruiters public posting API returns rows without descriptions;
// the adapter enriches kept rows from the posting detail endpoint under a
// time budget and never drops a listing when the detail read fails.
test("smartrecruiters adapter maps the public index and enriches with posting details", async () => {
  const mock = installFetch({
    "sr-test-co/postings?": {
      content: [
        {
          id: "744000157667338",
          name: "Associate - Mumbai",
          company: { identifier: "SRTestCo", name: "SR Test Co" },
          releasedDate: "2026-10-25T08:29:27.340Z",
          location: {
            city: "Mumbai",
            region: "MH",
            country: "in",
            remote: false,
            fullLocation: "Mumbai, MH, India",
          },
          typeOfEmployment: { id: "permanent", label: "Full-time" },
          department: { id: "technology", label: "Technology" },
        },
        {
          name: "Broken row has no id or url",
          company: { name: "Nobody" },
        },
      ],
    },
    "sr-test-co/postings/744000157667338": {
      active: true,
      postingUrl:
        "https://jobs.smartrecruiters.com/SRTestCo/744000157667338-associate",
      jobAd: {
        sections: {
          companyDescription: {
            title: "Company Description",
            text: "<p>Backend team at an Indian GCC.</p>",
          },
        },
      },
    },
  });

  try {
    const jobs = await smartrecruiters.fetchJobs({
      target: "sr-test-co",
      limit: 10,
    });

    assert.equal(jobs.length, 1);
    const job = jobs[0];
    assert.equal(job.source, "smartrecruiters");
    assert.equal(job.externalId, "sr-test-co:744000157667338");
    assert.equal(job.company, "SR Test Co");
    assert.equal(job.location, "Mumbai, MH, India");
    assert.equal(job.jobType, "full-time");
    assert.equal(job.remote, false);
    assert.equal(job.category, "Technology");
    // The detail response's canonical posting URL wins over the derived one.
    assert.equal(
      job.applicationUrl,
      "https://jobs.smartrecruiters.com/SRTestCo/744000157667338-associate"
    );
    assert.match(job.description, /Backend team at an Indian GCC/);
    assert.ok(
      job.postedAt instanceof Date &&
        job.postedAt.toISOString().startsWith("2026-10-25")
    );

    // The enriched page never fabricates rows: the broken row is dropped.
    assert.ok(mock.calls.length >= 2);
  } finally {
    mock.restore();
  }
});

test("smartrecruiters adapter keeps a board-reported summary when detail fetch fails", async () => {
  const mock = installFetch({
    "sr-fallback/postings?": {
      content: [
        {
          id: "1001",
          name: "Data Analyst",
          company: { identifier: "SRFallback", name: "SR Fallback Ltd" },
          releasedDate: "2026-10-24T00:00:00.000Z",
          location: { city: "Pune", country: "in" },
          typeOfEmployment: { id: "permanent", label: "Full-time" },
        },
      ],
    },
    "sr-fallback/postings/1001": (url) => jsonResponse({ message: "boom" }, 500),
  });

  try {
    const jobs = await smartrecruiters.fetchJobs({
      target: "sr-fallback",
      limit: 5,
    });
    assert.equal(jobs.length, 1);
    assert.equal(
      jobs[0].applicationUrl,
      "https://jobs.smartrecruiters.com/SRFallback/1001"
    );
    assert.ok(jobs[0].description.length >= 10);
    assert.match(jobs[0].description, /Data Analyst/);
  } finally {
    mock.restore();
  }
});

test("smartrecruiters adapter rejects missing targets and unexpected payloads", async () => {
  await assert.rejects(
    () => smartrecruiters.fetchJobs({}),
    (error) => error.code === "missing_target"
  );

  // Page one must be a posting index; anything else is setup corruption.
  const mock = installFetch({
    "sr-bad/postings?": { detail: "no content key" },
  });

  try {
    await assert.rejects(
      () => smartrecruiters.fetchJobs({ target: "sr-bad" }),
      (error) => error.code === "unexpected_payload"
    );
  } finally {
    mock.restore();
  }
});

test("smartrecruiters discovery isolates a failing board and keeps healthy sources", async () => {
  const mock = installFetch({
    "remotive.com": {
      jobs: [
        {
          id: 771,
          title: "Isolation Probe Intern",
          company_name: "Isolation Co",
          description: "<p>Validate that a dead SmartRecruiters board never hides live rows from healthy sources.</p>",
          candidate_required_location: "Remote",
          job_type: "internship",
          url: "https://remotive.example/jobs/771",
        },
      ],
    },
    "api.smartrecruiters.com": (url) => jsonResponse({ message: "gone" }, 500),
  });

  try {
    const result = await discoverJobs({
      sources: "smartrecruiters,remotive",
      search: "isolation",
      limit: 10,
    });

    const statuses = Object.fromEntries(
      result.sources.map((entry) => [entry.source, entry.status])
    );
    assert.equal(statuses.remotive, "ok");
    assert.equal(statuses.smartrecruiters, "failed");

    // Every SmartRecruiters board target fails independently and is reported
    // as its own error entry; none of them hides the healthy Remotive row.
    assert.ok(result.errors.length >= 1);
    for (const error of result.errors) {
      assert.equal(error.source, "smartrecruiters");
      assert.equal(error.code, "provider_error");
    }

    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].source, "remotive");
  } finally {
    mock.restore();
    clearJobsCache();
  }
});

test("a SmartRecruiters listing can be re-fetched and imported by id", async () => {
  const mock = installFetch({
    "sr-import/postings?": {
      content: [
        {
          id: "5555",
          name: "SDE Intern",
          company: { identifier: "SRImport", name: "SR Import Ltd" },
          releasedDate: "2026-10-23T00:00:00.000Z",
          location: { city: "Gurgaon", country: "in", fullLocation: "Gurgaon, HR, India" },
          typeOfEmployment: { id: "permanent", label: "Full-time" },
        },
      ],
    },
    "sr-import/postings/5555": { active: true, jobAd: { sections: {} } },
  });

  try {
    const job = await findDiscoveredJob({
      source: "smartrecruiters",
      externalId: "sr-import:5555",
    });

    assert.equal(job.source, "smartrecruiters");
    assert.equal(job.externalId, "sr-import:5555");
    assert.match(job.applicationUrl, /jobs\.smartrecruiters\.com\/SRImport\/5555/);
  } finally {
    mock.restore();
  }
});
