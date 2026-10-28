// Extract a job draft from a public job page.
//
// Only public page content is read: schema.org JobPosting JSON-LD first, then
// OpenGraph/meta tags. Login walls, CAPTCHAs, and bot checks are detected and
// reported — never bypassed.

import {
  buildNormalizedJob,
  cleanHtml,
  decodeEntities,
} from "../jobSources/normalize.js";

const MIN_DESCRIPTION = 120;

const PLATFORMS = [
  {
    match: /(^|\.)linkedin\.com$/,
    id: "linkedin",
    label: "LinkedIn",
    note: "LinkedIn has no public job API for this app. The draft is read from the public page you opened.",
  },
  {
    match: /(^|\.)internshala\.com$/,
    id: "internshala",
    label: "Internshala",
    note: "Internshala has no public job API. The draft is read from the public page you opened.",
  },
  {
    match: /(^|\.)(wellfound\.com|angel\.co)$/,
    id: "wellfound",
    label: "Wellfound",
    note: "Wellfound has no public job API. The draft is read from the public page you opened.",
  },
  {
    match: /(^|\.)(greenhouse\.io|greenhouse\.com)$/,
    id: "greenhouse",
    label: "Greenhouse job page",
    note: "Greenhouse boards can also be discovered through the API source when a board name is configured.",
  },
  {
    match: /(^|\.)lever\.co$/,
    id: "lever",
    label: "Lever job page",
    note: "Lever boards can also be discovered through the API source when a site name is configured.",
  },
  {
    match: /(^|\.)ashbyhq\.com$/,
    id: "ashby",
    label: "Ashby job page",
    note: "Ashby boards can also be discovered through the API source when an organization is configured.",
  },
  {
    match: /(^|\.)myworkdayjobs\.com$/,
    id: "workday",
    label: "Workday career site",
    note: "Workday pages usually need a real browser session; review the extracted draft carefully.",
  },
  {
    match: /(^|\.)(smartrecruiters\.com|bamboohr\.com|recruitee\.com|teamtailor\.com)$/,
    id: "ats",
    label: "Applicant tracking system",
    note: "The draft is read from the public page you opened.",
  },
];

const BLOCK_SIGNALS = [
  {
    pattern: /authwall|sign in to continue|please sign in to|you must be signed in/i,
    reason: "This page requires a signed-in session",
  },
  {
    pattern: /captcha|verify you are human|are you a robot|unusual traffic/i,
    reason: "This page is protected by a CAPTCHA or bot check",
  },
  {
    pattern: /enable javascript and cookies to continue|just a moment\.\.\./i,
    reason: "This page needs a real browser to render",
  },
  {
    pattern: /\baccess denied\b|\bforbidden\b/i,
    reason: "This page denied access to the request",
  },
];

function collapse(value, max = 300) {
  return decodeEntities(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function parseMetaTags(html) {
  const tags = new Map();

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = {};
    for (const attr of match[0].matchAll(
      /([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
    )) {
      attributes[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? "";
    }

    const key = (
      attributes.property ||
      attributes.name ||
      attributes.itemprop ||
      ""
    ).toLowerCase();

    if (key && attributes.content && !tags.has(key)) {
      tags.set(key, decodeEntities(attributes.content));
    }
  }

  return tags;
}

function parseJsonLdBlocks(html) {
  const blocks = [];
  const pattern =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(pattern)) {
    const raw = match[1]
      .trim()
      .replace(/^<!--/, "")
      .replace(/-->$/, "")
      .replace(/^<!\[CDATA\[|\]\]>$/g, "");

    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Malformed structured data is common; fall back to meta tags.
    }
  }

  return blocks;
}

function* walk(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) yield* walk(entry);
    return;
  }

  yield value;

  for (const key of ["@graph", "mainEntity", "itemListElement", "hasPart"]) {
    if (value[key]) yield* walk(value[key]);
  }
}

function findJobPosting(blocks) {
  for (const block of blocks) {
    for (const node of walk(block)) {
      const type = node["@type"];
      const types = Array.isArray(type) ? type : [type];
      if (types.some((entry) => String(entry).toLowerCase() === "jobposting")) {
        return node;
      }
    }
  }
  return null;
}

function formatLocation(location) {
  if (!location) return "";

  const places = Array.isArray(location) ? location : [location];
  const parts = [];

  for (const place of places) {
    if (typeof place === "string") {
      parts.push(place);
      continue;
    }

    const address = place?.address ?? place;
    if (typeof address === "string") {
      parts.push(address);
      continue;
    }

    const country =
      typeof address?.addressCountry === "string"
        ? address.addressCountry
        : address?.addressCountry?.name;

    const formatted = [
      address?.addressLocality,
      address?.addressRegion,
      country,
    ]
      .filter(Boolean)
      .join(", ");

    if (formatted) parts.push(formatted);
  }

  return [...new Set(parts)].join(" | ");
}

function formatSalary(baseSalary) {
  if (!baseSalary) return "";

  const value = baseSalary.value ?? baseSalary;
  const currency = baseSalary.currency || value?.currency || "";
  const minimum = value?.minValue ?? value?.value ?? "";
  const maximum = value?.maxValue ?? "";
  const unit = value?.unitText || "";

  const range = [minimum, maximum]
    .filter((entry) => entry !== "" && entry !== undefined)
    .join("-");

  return `${currency} ${range} ${unit}`.replace(/\s+/g, " ").trim().slice(0, 200);
}

function detectBlockedPage(html) {
  const sample = html.slice(0, 200000);
  for (const signal of BLOCK_SIGNALS) {
    if (signal.pattern.test(sample)) return signal.reason;
  }
  return null;
}

function detectPlatform(hostname, url) {
  const host = String(hostname || "").toLowerCase();

  const found = PLATFORMS.find((platform) => platform.match.test(host));
  if (found) return { id: found.id, label: found.label, note: found.note };

  if (/careers?|jobs?/i.test(String(url))) {
    return {
      id: "company_career_page",
      label: "Company career page",
      note: "The draft is read from the public page you opened.",
    };
  }

  return {
    id: "generic",
    label: "Web page",
    note: "The draft is read from the public page you opened.",
  };
}

function stripSiteSuffix(title, siteName) {
  let value = collapse(title, 250);
  if (!value) return "";

  for (const separator of [" | ", " - ", " — ", " · "]) {
    const [head, tail] = value.split(separator);
    if (
      tail &&
      siteName &&
      tail.toLowerCase().includes(siteName.toLowerCase().slice(0, 12)) &&
      head.length >= 5
    ) {
      value = head.trim();
      break;
    }
  }

  return value;
}

/**
 * @returns {{
 *   job: object|null,
 *   strategy: "json-ld"|"metadata"|null,
 *   confidence: "high"|"medium"|"low"|null,
 *   notes: string[],
 *   page: { title: string, siteName: string, blocked: boolean, reason: string|null },
 *   platform: { id: string, label: string, note: string, automaticIntegration: false }
 * }}
 */
export function extractJobFromHtml(html, { url }) {
  const pageUrl = new URL(url);
  const meta = parseMetaTags(html);
  const pageTitle = collapse(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
    250
  );
  const siteName = collapse(
    meta.get("og:site_name") || meta.get("application-name") || "",
    120
  );
  const blockedReason = detectBlockedPage(html);
  const notes = [];

  const platform = {
    ...detectPlatform(pageUrl.hostname, pageUrl.toString()),
    automaticIntegration: false,
  };

  const page = {
    title: pageTitle,
    siteName,
    blocked: Boolean(blockedReason),
    reason: blockedReason,
  };

  if (blockedReason) {
    return {
      job: null,
      strategy: null,
      confidence: null,
      notes: [
        `${blockedReason}. This assistant does not sign in, solve CAPTCHAs, or bypass access controls.`,
      ],
      page,
      platform,
    };
  }

  const posting = findJobPosting(parseJsonLdBlocks(html));

  if (posting) {
    const hiringOrganization =
      typeof posting.hiringOrganization === "string"
        ? posting.hiringOrganization
        : posting.hiringOrganization?.name;

    const location = formatLocation(posting.jobLocation);
    const remote =
      String(posting.jobLocationType || "").toUpperCase() === "TELECOMMUTE" ||
      /remote|anywhere/i.test(location);

    const identifier =
      typeof posting.identifier === "string"
        ? posting.identifier
        : posting.identifier?.value;

    const canonical =
      html.match(
        /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i
      )?.[1] ||
      html.match(
        /<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']canonical["']/i
      )?.[1];

    const applicationUrl = posting.url || canonical || pageUrl.toString();

    const job = buildNormalizedJob({
      source: "url",
      externalId: identifier,
      title: posting.title,
      company: hiringOrganization,
      description: posting.description,
      applicationUrl,
      location: location || (remote ? "Remote" : "Not specified"),
      jobType: posting.employmentType,
      remote,
      postedAt: posting.datePosted,
      category: posting.occupationalCategory || posting.industry,
      salary: formatSalary(posting.baseSalary),
    });

    if (job) {
      notes.push("Read the page's schema.org JobPosting data.");

      if (!hiringOrganization) {
        notes.push("Company name was inferred from the page — verify it.");
      }

      const confidence =
        hiringOrganization && job.description.length >= 200 ? "high" : "medium";

      return {
        job,
        strategy: "json-ld",
        confidence,
        notes,
        page,
        platform,
      };
    }

    notes.push(
      "The page has structured job data but it is incomplete, so a summary draft is shown instead."
    );
  }

  // Metadata fallback: good enough to prefill a manual import, clearly lower
  // confidence because titles and descriptions are page-level, not job-level.
  const heading = collapse(
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "",
    250
  );

  const title = stripSiteSuffix(
    meta.get("og:title") || meta.get("twitter:title") || heading || pageTitle,
    siteName
  );

  const description = cleanHtml(
    meta.get("og:description") ||
      meta.get("description") ||
      meta.get("twitter:description") ||
      heading
  );

  const company =
    siteName ||
    pageUrl.hostname.replace(/^www\./, "").split(".")[0].replace(/[-_]/g, " ");

  const job =
    title && description.length >= MIN_DESCRIPTION
      ? buildNormalizedJob({
          source: "url",
          title,
          company: company.replace(/\b\w/g, (char) => char.toUpperCase()),
          description,
          applicationUrl: pageUrl.toString(),
          location: /remote|anywhere/i.test(description) ? "Remote" : "",
          remote: /remote|anywhere/i.test(description),
        })
      : null;

  if (job) {
    notes.push(
      "Only page metadata was available. Review the title, company, and description before saving."
    );

    return {
      job,
      strategy: "metadata",
      confidence: "low",
      notes,
      page,
      platform,
    };
  }

  notes.push(
    "No structured job data and no usable description were found on this page."
  );

  return {
    job: null,
    strategy: null,
    confidence: null,
    notes,
    page,
    platform,
  };
}
