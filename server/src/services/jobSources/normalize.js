// Shared normalization helpers for every job source adapter.
//
// Adapters only translate a provider payload into plain objects that satisfy
// the Job model. All validation, trimming, and skill extraction happens here so
// every source yields the same shape.

import { extractSkills } from "../../utils/skills.js";

const MAX_DESCRIPTION = 30000;

const HTML_ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&rsquo;": "\u2019",
  "&lsquo;": "\u2018",
  "&ldquo;": "\u201c",
  "&rdquo;": "\u201d",
  "&ndash;": "\u2013",
  "&mdash;": "\u2014",
  "&hellip;": "\u2026",
  "&bull;": "\u2022",
};

export function decodeEntities(input = "") {
  return String(input)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
    .replace(
      /&(nbsp|amp|lt|gt|quot|#39|apos|rsquo|lsquo|ldquo|rdquo|ndash|mdash|hellip|bull);/gi,
      (match) => HTML_ENTITIES[match.toLowerCase()] ?? match
    );
}

// Providers mix escaped markup (Greenhouse), real markup (Ashby), and plain
// text (Lever). Decoding twice makes "&lt;p&gt;" behave like "<p>".
export function cleanHtml(input = "", { decode = true } = {}) {
  let text = String(input ?? "");
  if (decode) {
    text = decodeEntities(text);
    if (/&lt;\s*\/?[a-z]/i.test(text)) text = decodeEntities(text);
  }

  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|li|div|h[1-6]|tr|ul|ol|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_DESCRIPTION);
}

const JOB_TYPE_MAP = {
  full_time: "full-time",
  fulltime: "full-time",
  "full-time": "full-time",
  part_time: "part-time",
  parttime: "part-time",
  "part-time": "part-time",
  contract: "contract",
  contractor: "contract",
  internship: "internship",
  intern: "internship",
  trainee: "internship",
  temporary: "temporary",
  temp: "temporary",
  freelance: "contract",
  volunteer: "other",
  other: "other",
};

export function normalizeJobType(value) {
  const raw = Array.isArray(value) ? value.join(",") : value;
  const tokens = String(raw ?? "")
    .toLowerCase()
    .split(/[,/|]/)
    .map((token) => token.replace(/\s+/g, "_").trim())
    .filter(Boolean);

  if (!tokens.length) return "other";

  // Values such as "Full-time, Internship" arrive as lists;
  // internship wins because it is the most specific constraint.
  if (tokens.some((token) => /intern|trainee/.test(token))) {
    return "internship";
  }

  for (const token of tokens) {
    if (JOB_TYPE_MAP[token]) return JOB_TYPE_MAP[token];
  }

  return "other";
}

export function normalizeDate(value) {
  if (value === undefined || value === null || value === "") return undefined;

  // Some providers (Arbeitnow) send Unix seconds while others send ISO strings
  // or milliseconds. Treat anything below 1e11 as seconds.
  const numeric = typeof value === "number" ? value : Number.NaN;
  const input =
    Number.isFinite(numeric) && numeric > 0 && numeric < 1e11
      ? numeric * 1000
      : value;

  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function sanitizeUrl(value) {
  if (!value) return undefined;
  try {
    const url = new URL(String(value).trim());
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    if (url.username || url.password) return undefined;
    url.hash = "";
    return url.toString().slice(0, 2000);
  } catch {
    return undefined;
  }
}

function trimmed(value, max) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function isRemote({ remote, location, description }) {
  if (typeof remote === "boolean") return remote;
  const haystack = `${location ?? ""} ${description ?? ""}`.toLowerCase();
  return /(^|\b)(remote|anywhere|work from home|distributed)(\b|$)/.test(
    haystack
  );
}

/**
 * Build a Job-shaped record from provider data.
 * Returns null when required fields are missing or unusable.
 */
export function buildNormalizedJob({
  source,
  externalId,
  title,
  company,
  description,
  applicationUrl,
  location,
  jobType,
  remote,
  postedAt,
  category,
  salary,
}) {
  const cleanTitle = trimmed(title, 250);
  const cleanCompany = trimmed(company, 200);
  const cleanDescription = cleanHtml(description);

  if (cleanTitle.length < 2 || cleanCompany.length < 1) return null;
  if (cleanDescription.length < 10) return null;

  const url = sanitizeUrl(applicationUrl);
  if (!url) return null;

  const cleanLocation = trimmed(location, 200) || "Not specified";

  return {
    source,
    externalId: externalId === undefined || externalId === null
      ? undefined
      : String(externalId).slice(0, 120),
    title: cleanTitle,
    company: cleanCompany,
    description: cleanDescription,
    skills: extractSkills(`${cleanTitle} ${cleanCompany} ${cleanDescription}`).slice(
      0,
      30
    ),
    location: cleanLocation,
    jobType: normalizeJobType(jobType),
    remote: isRemote({
      remote,
      location: cleanLocation,
      description: `${cleanTitle} ${cleanDescription}`,
    }),
    applicationUrl: url,
    postedAt: normalizeDate(postedAt),
    category: trimmed(category, 120),
    salary: trimmed(salary, 200),
  };
}

export function matchesSearch(job, search = "") {
  const term = String(search).trim().toLowerCase();
  if (!term) return true;
  return `${job.title} ${job.company} ${job.category ?? ""} ${job.location} ${job.description}`
    .toLowerCase()
    .includes(term);
}

// Location terms used when a location search targets India. Indian listings
// frequently name only a city or state, so "india" also matches the major
// metros and states recruiters commonly write. This never invents a location
// the source did not report; it only decides whether a reported one matches.
export const INDIA_LOCATION_TERMS = [
  "india",
  "bengaluru",
  "bangalore",
  "hyderabad",
  "pune",
  "mumbai",
  "chennai",
  "delhi",
  "gurgaon",
  "gurugram",
  "noida",
  "kolkata",
  "calcutta",
  "ahmedabad",
  "jaipur",
  "chandigarh",
  "kochi",
  "cochin",
  "coimbatore",
  "indore",
  "lucknow",
  "bhopal",
  "nagpur",
  "surat",
  "vadodara",
  "patna",
  "guwahati",
  "bhubaneswar",
  "mysore",
  "mysuru",
  "trivandrum",
  "thiruvananthapuram",
  "visakhapatnam",
  "vijayawada",
  "ncr",
  "rajasthan",
  "maharashtra",
  "karnataka",
  "tamil nadu",
  "telangana",
  "uttar pradesh",
  "kerala",
  "gujarat",
  "west bengal",
  "madhya pradesh",
  "punjab",
  "haryana",
  "himachal pradesh",
  "uttarakhand",
  "odisha",
  "assam",
  "bihar",
  "goa",
];

/**
 * India-first ordering helper for discovery.
 *
 * Applied with a stable index sort AFTER cross-source dedupe and interleaving,
 * so the source-diversity guarantee is preserved within each group and no job
 * is dropped — matching Indian listings are just surfaced ahead of the rest
 * when the user did not narrow the location themselves.
 */
export function sortIndiaFirst(jobs = []) {
  return jobs
    .map((job, index) => ({ job, index, india: matchesLocation(job, "india") }))
    .sort((a, b) =>
      a.india === b.india ? a.index - b.index : a.india ? -1 : 1
    )
    .map((entry) => entry.job);
}

/**
 * Filter helper for discovery: does a job's reported location satisfy the
 * user's location query? "india" also matches Indian cities and states.
 */
export function matchesLocation(job, location = "") {
  const query = String(location ?? "")
    .trim()
    .toLowerCase();
  if (!query) return true;

  const haystack = String(job?.location ?? "").toLowerCase();
  if (!haystack || haystack === "not specified") return false;

  if (haystack.includes(query)) return true;

  if (/(^|\s)india($|\s)|^indian$/.test(query)) {
    return INDIA_LOCATION_TERMS.some((term) => haystack.includes(term));
  }

  return false;
}

export function dedupeJobs(jobs = []) {
  const byKey = new Map();

  for (const job of jobs) {
    if (!job) continue;

    const urlKey = urlDedupeKey(job.applicationUrl);
    const identityKey = `${job.company}::${job.title}`
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

    const existing =
      (urlKey && byKey.get(`url:${urlKey}`)) || byKey.get(`id:${identityKey}`);

    if (existing) {
      existing.duplicateSources = [
        ...new Set([...(existing.duplicateSources ?? []), job.source]),
      ].filter((name) => name !== existing.source);
      continue;
    }

    const record = { ...job, duplicateSources: [] };
    byKey.set(`id:${identityKey}`, record);
    if (urlKey) byKey.set(`url:${urlKey}`, record);
  }

  return [...new Set(byKey.values())];
}

// Mirrors the Job model's dedupe key so discovery previews and persisted jobs
// agree on what "the same listing" means.
export function urlDedupeKey(applicationUrl) {
  try {
    const url = new URL(applicationUrl);
    url.hash = "";
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "source",
    ];
    for (const param of trackingParams) url.searchParams.delete(param);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.hostname}${pathname}${url.search}`.toLowerCase();
  } catch {
    return "";
  }
}

export { MAX_DESCRIPTION };
