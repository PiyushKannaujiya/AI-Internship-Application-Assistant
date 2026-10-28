import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  assertSafeTarget,
  isPrivateAddress,
} from "../src/utils/safeUrl.js";
import { extractJobFromHtml } from "../src/services/urlImport/extract.js";
import { fetchJobPage } from "../src/services/urlImport/pageFetch.js";
import { importJobFromUrl } from "../src/services/urlImport/index.js";

const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// Guard used by local fixture tests: validates every hop but permits loopback.
function localGuard(allowedHosts = ["127.0.0.1"]) {
  const calls = [];
  const guard = async (raw) => {
    const url = new URL(String(raw));
    calls.push(url.toString());
    assert.ok(
      allowedHosts.includes(url.hostname),
      `guard rejected unexpected host ${url.hostname}`
    );
    return { url, addresses: [url.hostname] };
  };
  guard.calls = calls;
  return guard;
}

const LONG_DESCRIPTION =
  "Build and operate Node.js services backed by MongoDB. You will pair with senior engineers, write tests, review code, and ship small features to production every week. This internship runs for six months with a mentor.";

const JSON_LD_PAGE = `<!doctype html>
<html><head>
  <title>Backend Engineering Intern | Acme Careers</title>
  <meta property="og:site_name" content="Acme Careers">
  <link rel="canonical" href="https://acme.example/jobs/backend-intern">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "name": "Acme Systems" },
      {
        "@type": "JobPosting",
        "title": "Backend Engineering Intern",
        "description": "${LONG_DESCRIPTION}",
        "datePosted": "2026-10-01",
        "employmentType": "INTERN",
        "hiringOrganization": { "@type": "Organization", "name": "Acme Systems" },
        "jobLocation": {
          "@type": "Place",
          "address": {
            "@type": "PostalAddress",
            "addressLocality": "Bengaluru",
            "addressRegion": "Karnataka",
            "addressCountry": "IN"
          }
        },
        "baseSalary": {
          "@type": "MonetaryAmount",
          "currency": "INR",
          "value": {
            "@type": "QuantitativeValue",
            "minValue": 30000,
            "maxValue": 40000,
            "unitText": "MONTH"
          }
        },
        "url": "https://acme.example/jobs/backend-intern",
        "identifier": { "@type": "PropertyValue", "value": "acme-123" }
      }
    ]
  }
  </script>
</head><body><h1>Backend Engineering Intern</h1></body></html>`;

test("private, loopback, link-local, and reserved addresses are rejected", () => {
  const blocked = [
    "127.0.0.1",
    "127.1.2.3",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "fc00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
  ];

  for (const address of blocked) {
    assert.equal(isPrivateAddress(address), true, `${address} should be private`);
  }

  for (const address of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"]) {
    assert.equal(isPrivateAddress(address), false, `${address} should be public`);
  }
});

test("unsafe URL shapes are blocked before any network access", async () => {
  const cases = [
    ["http://example.com/job", /HTTPS/],
    ["ftp://example.com/job", /http\(s\)/],
    ["javascript:alert(1)", /http\(s\)/],
    ["file:///etc/passwd", /http\(s\)/],
    ["https://user:pass@example.com/job", /credentials/],
    ["https://localhost/job", /Local and internal/],
    ["https://app.localhost/job", /Local and internal/],
    ["https://printer.local/job", /Local and internal/],
    ["https://metadata.google.internal/job", /Local and internal/],
    ["https://127.0.0.1/job", /Private, loopback/],
    ["https://[::1]/job", /Private, loopback/],
    ["https://169.254.169.254/latest/meta-data/", /Private, loopback/],
    ["https://example.com:8443/job", /standard HTTPS ports/],
  ];

  for (const [url, expected] of cases) {
    await assert.rejects(
      () => assertSafeTarget(url, { resolver: PUBLIC_RESOLVER }),
      (error) => {
        assert.equal(error.statusCode, 400, `${url} should be a 400`);
        assert.equal(error.code, "URL_BLOCKED");
        assert.match(error.message + JSON.stringify(error.details), expected);
        return true;
      },
      `${url} should be blocked`
    );
  }
});

test("DNS answers are validated, including mixed public/private records", async () => {
  await assert.rejects(
    () =>
      assertSafeTarget("https://jobs.example.com/role", {
        resolver: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.7", family: 4 },
        ],
      }),
    (error) => error.code === "URL_BLOCKED"
  );

  await assert.rejects(
    () =>
      assertSafeTarget("https://jobs.example.com/role", {
        resolver: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    (error) => error.code === "URL_BLOCKED"
  );

  const safe = await assertSafeTarget("https://jobs.example.com/role", {
    resolver: PUBLIC_RESOLVER,
  });
  assert.equal(safe.url.hostname, "jobs.example.com");
  assert.deepEqual(safe.addresses, ["93.184.216.34"]);
});

test("historical JSON-LD parsing supports @graph and formats salary", () => {
  const result = extractJobFromHtml(JSON_LD_PAGE, {
    url: "https://acme.example/jobs/backend-intern",
  });

  assert.equal(result.strategy, "json-ld");
  assert.equal(result.confidence, "high");
  assert.ok(result.job);
  assert.equal(result.job.source, "url");
  assert.equal(result.job.title, "Backend Engineering Intern");
  assert.equal(result.job.company, "Acme Systems");
  assert.equal(result.job.jobType, "internship");
  assert.equal(result.job.location, "Bengaluru, Karnataka, IN");
  assert.equal(result.job.externalId, "acme-123");
  assert.equal(result.job.salary, "INR 30000-40000 MONTH");
  assert.match(result.job.applicationUrl, /acme\.example/);
  assert.ok(result.job.skills.includes("Node.js"));
  assert.ok(result.job.skills.includes("MongoDB"));
  assert.equal(result.platform.automaticIntegration, false);
});

test("TELECOMMUTE postings are marked remote", () => {
  const html = `<html><head>
    <script type="application/ld+json">
    {
      "@type": "JobPosting",
      "title": "Remote Data Intern",
      "description": "${LONG_DESCRIPTION}",
      "hiringOrganization": { "name": "Remote Co" },
      "jobLocationType": "TELECOMMUTE",
      "employmentType": "FULL_TIME",
      "url": "https://remote.example/jobs/1"
    }
    </script>
  </head></html>`;

  const result = extractJobFromHtml(html, { url: "https://remote.example/jobs/1" });

  assert.ok(result.job);
  assert.equal(result.job.remote, true);
  assert.equal(result.job.jobType, "full-time");
});

test("pages without structured data fall back to a low-confidence draft", () => {
  const html = `<html><head>
    <title>Frontend Intern - Beta Labs</title>
    <meta property="og:site_name" content="Beta Labs">
    <meta property="og:description" content="Join Beta Labs as a frontend intern building accessible React and TypeScript interfaces with the design systems team. You will ship components every week and review code with senior engineers.">
  </head><body><h1>Frontend Intern</h1></body></html>`;

  const result = extractJobFromHtml(html, {
    url: "https://careers.betalabs.example/frontend-intern",
  });

  assert.equal(result.strategy, "metadata");
  assert.equal(result.confidence, "low");
  assert.ok(result.job);
  assert.equal(result.job.title, "Frontend Intern");
  assert.equal(result.job.company, "Beta Labs");
  assert.ok(result.notes.some((note) => /Review the title/i.test(note)));
});

test("login walls and CAPTCHAs are reported and never bypassed", () => {
  for (const html of [
    "<html><body><h1>Sign in to continue</h1></body></html>",
    "<html><body><p>Please verify you are human</p></body></html>",
    "<html><body>Access Denied</body></html>",
  ]) {
    const result = extractJobFromHtml(html, {
      url: "https://www.linkedin.com/jobs/view/123",
    });

    assert.equal(result.job, null);
    assert.equal(result.page.blocked, true);
    assert.equal(result.platform.id, "linkedin");
    assert.ok(result.notes.some((note) => /does not sign in|bypass/i.test(note)));
  }
});

test("unreadable pages produce no job instead of a fabricated one", () => {
  const result = extractJobFromHtml("<html><head><title>Home</title></head><body>Hi</body></html>", {
    url: "https://example.com/",
  });

  assert.equal(result.job, null);
  assert.equal(result.strategy, null);
  assert.ok(result.notes.length > 0);
});

test("redirect hops are re-validated against the guard", async () => {
  const { baseUrl, close } = await startServer((req, res) => {
    if (req.url === "/start") {
      res.writeHead(302, { Location: "/private-admin" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(JSON_LD_PAGE);
  });

  const guard = async (raw) => {
    const url = new URL(String(raw));
    if (url.pathname === "/private-admin") {
      const error = new Error("Blocked redirect destination");
      error.code = "URL_BLOCKED";
      throw error;
    }
    return { url, addresses: ["127.0.0.1"] };
  };

  try {
    await assert.rejects(() => fetchJobPage(`${baseUrl}/start`, { guard }), (error) => {
      assert.equal(error.code, "URL_BLOCKED");
      return true;
    });
  } finally {
    await close();
  }
});

test("response size and content type limits are enforced", async () => {
  const { baseUrl, close } = await startServer((req, res) => {
    if (req.url === "/large") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body>${"a".repeat(4096)}</body></html>`);
      return;
    }

    res.writeHead(200, { "Content-Type": "application/pdf" });
    res.end("%PDF-1.4 fake");
  });

  const guard = localGuard();

  try {
    await assert.rejects(
      () => fetchJobPage(`${baseUrl}/large`, { guard, maxBytes: 1024 }),
      (error) => error.code === "RESPONSE_TOO_LARGE" && error.statusCode === 413
    );

    await assert.rejects(
      () => fetchJobPage(`${baseUrl}/file`, { guard }),
      (error) => error.code === "UNSUPPORTED_CONTENT_TYPE" && error.statusCode === 415
    );
  } finally {
    await close();
  }
});

test("a slow page is capped by the deadline", async () => {
  const { baseUrl, close } = await startServer(() => {
    // Intentionally never responds.
  });

  const guard = localGuard();

  try {
    await assert.rejects(
      () => fetchJobPage(`${baseUrl}/slow`, { guard, timeoutMs: 120 }),
      (error) => error.code === "UPSTREAM_TIMEOUT" && error.statusCode === 504
    );
  } finally {
    await close();
  }
});

test("hostnames are pinned to the validated address", async () => {
  const { baseUrl, close } = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(JSON_LD_PAGE);
  });

  const port = new URL(baseUrl).port;
  const guard = async (raw) => {
    const url = new URL(String(raw));
    assert.equal(url.hostname, "localhost");
    // Resolving the hostname makes Node use the pinned lookup path.
    return { url, addresses: ["127.0.0.1"] };
  };

  try {
    const page = await fetchJobPage(`http://localhost:${port}/job`, { guard });
    assert.equal(page.status, 200);
    assert.match(page.html, /JobPosting/);
  } finally {
    await close();
  }
});

test("URL import returns a reviewable draft from a real page fetch", async () => {
  const { baseUrl, close } = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(JSON_LD_PAGE);
  });

  const guard = localGuard();

  try {
    const result = await importJobFromUrl(`${baseUrl}/job`, { guard });

    assert.equal(result.extracted, true);
    assert.equal(result.strategy, "json-ld");
    assert.equal(result.job.title, "Backend Engineering Intern");
    assert.equal(result.manualImport, null);
    assert.equal(result.automaticIntegration, false);
    assert.deepEqual(guard.calls, [`${baseUrl}/job`]);
  } finally {
    await close();
  }
});

test("blocked and unreadable responses return the manual import fallback", async () => {
  const { baseUrl, close } = await startServer((req, res) => {
    if (req.url === "/forbidden") {
      res.writeHead(403, { "Content-Type": "text/html" });
      res.end("<html><body>Forbidden</body></html>");
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><head><title>Jobs</title></head><body>Nothing here</body></html>");
  });

  const guard = localGuard();

  try {
    const forbidden = await importJobFromUrl(`${baseUrl}/forbidden`, { guard });
    assert.equal(forbidden.extracted, false);
    assert.equal(forbidden.job, null);
    assert.ok(forbidden.manualImport);
    assert.deepEqual(forbidden.manualImport.required, [
      "title",
      "company",
      "description",
      "applicationUrl",
    ]);
    assert.match(forbidden.notes.join(" "), /does not bypass access controls/i);

    const empty = await importJobFromUrl(`${baseUrl}/empty`, { guard });
    assert.equal(empty.extracted, false);
    assert.ok(empty.manualImport);
    assert.equal(empty.manualImport.prefill.applicationUrl, `${baseUrl}/empty`);
  } finally {
    await close();
  }
});

test("the service refuses private destinations with default settings", async () => {
  await assert.rejects(
    () => importJobFromUrl("http://127.0.0.1:9/job"),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "URL_BLOCKED");
      return true;
    }
  );
});
