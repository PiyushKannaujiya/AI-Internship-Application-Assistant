// SmartRecruiters adapter: reads the company's own public posting API.
//
// Documented at https://developers.smartrecruiters.com/docs/endpoints and
// verified live on 2026-10-25 against real boards (WNS, LinkedIn, Nagarro,
// Western Digital, Grab, Jitterbit):
//   GET https://api.smartrecruiters.com/v1/companies/{companyId}/postings
//       ?limit=100&offset=<n>&country=in
// returns { content: [{ id, name, company: { name, identifier }, releasedDate,
//   location: { city, region, country: "in", remote, hybrid, fullLocation },
//   typeOfEmployment: { id, label }, department, function, industry,
//   experienceLevel }]} — page 1 arrives sorted newest-first.
//
// List rows carry no description, so each kept posting is optionally enriched
// with one extra request that returns the real job-ad HTML
// (posting detail → jobAd.sections). Enrichment is bounded both in concurrency
// and by a time budget derived from the discovery deadline: when the budget
// runs out the posting keeps a short description built from fields the board
// itself reported (title, department, employment type, location) instead of
// being dropped. Nothing is invented anywhere: URLs are the canonical
// jobs.smartrecruiters.com/{CompanyIdentifier}/{id} form that live checks
// confirmed resolves without a slug.

import { env } from "../../config/env.js";
import { fetchJson, parseTargetParameter, SourceError } from "./httpClient.js";
import {
  buildNormalizedJob,
  cleanHtml,
  matchesSearch,
  sanitizeUrl,
} from "./normalize.js";

export const name = "smartrecruiters";
export const label = "SmartRecruiters job boards";
export const attribution =
  "Public posting APIs hosted by SmartRecruiters (https://developers.smartrecruiters.com)";
export const requiresTarget = true;

// Default boards were live-verified on 2026-10-25 (HTTP 200, country=in rows,
// fresh 2026 postings with India locations). Extend via SMARTRECRUITERS_BOARDS
// or the boards query parameter.
export const DEFAULT_TARGETS = [
  "linkedin3",
  "wnsglobalservices144",
  "westerndigital",
  "nagarro1",
  "grab",
  "jitterbit",
];

const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const DETAIL_CONCURRENCY = 4;

const API_BASE = "https://api.smartrecruiters.com/v1/companies";

function companyCountry() {
  // India-first by default: fetching the country-filtered index keeps huge
  // boards (LinkedIn's own has thousands of non-India postings) from crowding
  // out the Indian ones in a bounded page budget. Set SMARTRECRUITERS_COUNTRY
  // to a different 2-letter code, or leave it out to read the whole board.
  return env.SMARTRECRUITERS_COUNTRY;
}

export function listUrl(target, { page = 1, country } = {}) {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
  });
  if (country) params.set("country", country);
  return `${API_BASE}/${encodeURIComponent(target)}/postings?${params.toString()}`;
}

export function postingDetailUrl(target, postingId) {
  return `${API_BASE}/${encodeURIComponent(target)}/postings/${encodeURIComponent(
    postingId
  )}`;
}

export function boardUrl(target) {
  return listUrl(target, { country: companyCountry() });
}

function prettifyBoard(target) {
  return target
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

const COUNTRY_NAMES = { in: "India" };

function boardLocation(location) {
  if (!location) return "";

  const full = String(location.fullLocation || "").trim();
  if (full) return full;

  const countryName =
    COUNTRY_NAMES[String(location.country || "").toLowerCase()] ||
    (typeof location.country === "string" ? location.country : "");
  return [
    location.city,
    location.region,
    location.state,
    countryName,
  ]
    .filter((part) => typeof part === "string" && part.trim())
    .join(", ");
}

function rowJobType(row) {
  const employment = row?.typeOfEmployment;
  if (!employment) return "";

  const label = String(employment.label || "").trim();
  const id = String(employment.id || "").trim();

  // The label is human text ("Full-time"); the id can be "permanent", which
  // maps to full-time rather than "other".
  if (label && !/permanent/i.test(label)) return label;
  if (/permanent/i.test(label)) return "full-time";
  if (/permanent/i.test(id)) return "full-time";
  return label || id;
}

// Short, board-reported summary used when the per-posting detail request did
// not run (skipped, failed, or the discovery time budget was exhausted). It
// only repeats fields the employer posted; no content is generated.
function summaryDescription(row, location) {
  const summary = [
    row?.name,
    row?.company?.name,
    row?.department?.label,
    row?.function?.label,
    row?.industry?.label,
    row?.experienceLevel?.label,
    row?.typeOfEmployment?.label,
    location,
  ]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" — ")
    .slice(0, 400);

  // buildNormalizedJob drops rows whose description is under 10 chars; a
  // short, factual pointer keeps every board-reported row visible until the
  // detail pass (or the user's own "open original" click) supplies the text.
  return summary.length >= 10
    ? summary
    : `${summary} ${row?.company?.name || ""} listing`.trim();
}

function postingUrl(row, companyIdentifier) {
  const postingId = String(row?.id || "").trim();
  if (!postingId) return undefined;
  const identifier =
    String(companyIdentifier || row?.company?.identifier || "").trim() ||
    String(row?.company?.name || "").trim();
  if (!identifier) return undefined;
  return `https://jobs.smartrecruiters.com/${encodeURIComponent(
    identifier
  )}/${encodeURIComponent(postingId)}`;
}

function flatSections(detail) {
  const raw = detail?.jobAd?.sections;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([key, value]) => ({
      title: value?.title || key,
      text: value?.text || "",
    }));
  }
  return [];
}

// Read the job-ad HTML for one posting and return plain text. Boards vary in
// section availability, so ids stay optional and the caller falls back to the
// summary description when detail fetch fails.
async function fetchDetailDescription(target, postingId, timeoutMs) {
  const detail = await fetchJson(postingDetailUrl(target, postingId), {
    timeoutMs,
  });

  if (!detail?.active) return { description: null, postingUrl: null };

  const text = flatSections(detail)
    .filter((section) => section?.text)
    .map((section) => `${section.title || ""}\n${section.text}`)
    .join("\n\n");

  return {
    description: text.trim() ? cleanHtml(text, { decode: true }) : null,
    // The posting detail response carries the canonical public job URL.
    postingUrl: sanitizeUrl(detail.postingUrl) || null,
  };
}

export async function fetchJobs({
  target,
  limit = 20,
  search = "",
  timeoutMs = env.JOB_SOURCE_TIMEOUT_MS,
} = {}) {
  if (!target) {
    throw new SourceError(
      "missing_target",
      "A SmartRecruiters company id is required"
    );
  }

  const company = prettifyBoard(target);
  const country = companyCountry();
  const startedAt = Date.now();

  // The posting index is served newest-first (verified live), so a bounded
  // page walk reads the freshest postings first.
  let rows = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await fetchJson(
      listUrl(target, { page, country }),
      {
        timeoutMs: Math.max(500, timeoutMs - (Date.now() - startedAt)),
      }
    );

    const content = Array.isArray(payload?.content) ? payload.content : [];
    if (page === 1 && !Array.isArray(payload?.content)) {
      throw new SourceError(
        "unexpected_payload",
        `SmartRecruiters board "${target}" returned an unexpected response`
      );
    }

    rows = rows.concat(content);
    if (content.length < PAGE_SIZE) break;
  }

  const normalized = rows
    .map((row) => {
      if (!row || row.id === undefined || !row.name) return null;

      const location = boardLocation(row.location);

      const base = buildNormalizedJob({
        source: name,
        externalId: `${target}:${row.id}`,
        title: row.name,
        company: row.company?.name || company,
        description: summaryDescription(row, location),
        applicationUrl: postingUrl(row, row.company?.identifier),
        location,
        jobType: rowJobType(row),
        remote: Boolean(row.location?.remote),
        postedAt: row.releasedDate,
        category: row.department?.label || row.function?.label || "",
      });
      return base ? { base, postingId: row.id } : null;
    })
    .filter(Boolean)
    .filter(({ base }) => matchesSearch(base, search))
    .slice(0, limit);

  // Detail enrichment is a bounded first-come enrichment pass, not a
  // requirement: it stops early when the discovery deadline approaches so the
  // board still returns fresh rows with their summary descriptions.
  const enriched = await enrichWithDetails(normalized, {
    target,
    startedAt,
    timeoutMs,
  });

  return enriched;
}

// Small worker pool: DETAIL_CONCURRENCY detail requests at a time, skipped
// entirely once the remaining time budget drops below the margin.
async function enrichWithDetails(entries, { target, startedAt, timeoutMs }) {
  if (!entries.length) return entries;

  // Leave the caller's +1000ms hard timeout buffer untouched.
  const detailDeadline = startedAt + timeoutMs * 0.75;

  const queue = entries.map((entry, index) => ({ entry, index }));
  const results = new Array(entries.length);

  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      if (Date.now() > detailDeadline) return;

      const { entry, index } = next;
      let job = entry.base;

      try {
        const remaining = Math.max(
          500,
          timeoutMs - (Date.now() - startedAt)
        );
        const detail = await fetchDetailDescription(
          target,
          entry.postingId,
          remaining
        );
        if (detail.description || detail.postingUrl) {
          const rebuilt = buildNormalizedJob({
            source: name,
            externalId: job.externalId,
            title: job.title,
            company: job.company,
            description: detail.description || job.description,
            // The detail response's postingUrl is the employer's canonical
            // public listing URL; the derived short form is the fallback.
            applicationUrl: detail.postingUrl || job.applicationUrl,
            location: job.location,
            jobType: job.jobType,
            remote: job.remote,
            postedAt: job.postedAt,
            category: job.category,
          });
          if (rebuilt) job = rebuilt;
        }
      } catch {
        // Detail miss never drops a row; the summary description stands.
      }

      results[index] = job;
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(DETAIL_CONCURRENCY, queue.length) },
      () => worker()
    )
  );

  return resolveResults(results, entries);
}

// Workers may leave slots unwritten when the deadline expires; keep the base
// record in those gaps so result order stays aligned with the input. A plain
// loop is used because .map on a sparse array would preserve the holes.
function resolveResults(results, entries) {
  const dense = [];
  for (let index = 0; index < entries.length; index += 1) {
    dense.push(results[index] || entries[index].base);
  }
  return dense;
}
