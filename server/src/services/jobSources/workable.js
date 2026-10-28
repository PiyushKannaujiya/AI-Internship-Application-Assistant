// Workable adapter: reads the public, keyless jobs widget feed that Workable
// itself generates for every company's careers page.
//
// Verified against live boards on 2026-10-25:
//   GET https://apply.workable.com/api/v1/widget/accounts/{account}?details=true
// returns {..., jobs: [{ title, shortcode, url, shortlink, employment_type,
//   telecommuting, department: {name}, function: {name}, country: "India",
//   city, locations: [{ country, province, city }], description, published_on,
//   created_at }]}
//
// `details=true` matters: it makes the feed include the full job description in
// the same single request, so boards are read with one HTTP call per company
// and no per-posting follow-ups. The `/spi/v3/jobs` route is Workable's
// token-authenticated API and is deliberately NOT used; only the same public
// widget endpoint the careers page itself serves from is consumed.
//
// Failed boards are reported as SourceError so one dead company board never
// hides healthy listings from the other sources.

import { fetchJson, parseTargetParameter, SourceError } from "./httpClient.js";
import { buildNormalizedJob, matchesSearch } from "./normalize.js";

export const name = "workable";
export const label = "Workable job boards";
export const attribution =
  "Listings read from public Workable job boards (https://apply.workable.com)";
export const requiresTarget = true;

// Verified live boards hiring engineers in India (2026-10-25, HTTP 200,
// non-empty India-parity jobs). User-extensible via WORKABLE_BOARDS or the
// boards query parameter.
export const DEFAULT_TARGETS = [
  "exponent-energy",
  "mercari-india",
  "rapyuta-robotics",
  "cloudstuff",
  "gotymex",
];

const WORKABLE_HOST = "apply.workable.com";

export function boardUrl(target) {
  return `https://${WORKABLE_HOST}/api/v1/widget/accounts/${encodeURIComponent(
    target
  )}?details=true`;
}

function prettifyBoard(target) {
  return target
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

// Prefer the feed's own job URL when it points at the Workable domain; the
// live check confirmed those links resolve. Anything else (non-https, custom
// host, missing) falls back to the account-prefixed public job page, which was
// also verified to resolve for the same shortcode.
function jobUrl(row, target) {
  const candidates = [row?.url, row?.shortlink, row?.application_url];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    try {
      const url = new URL(candidate.trim());
      if (url.protocol === "https:" && url.hostname === WORKABLE_HOST) {
        return url.toString().slice(0, 2000);
      }
    } catch {
      continue;
    }
  }

  const shortcode = String(row?.shortcode || row?.code || "").trim();
  if (!shortcode) return undefined;
  return `https://${WORKABLE_HOST}/${encodeURIComponent(
    target
  )}/j/${encodeURIComponent(shortcode)}/`;
}

function jobLocation(row) {
  const entries = Array.isArray(row?.locations) ? row.locations : [];
  const visible = entries.filter((entry) => entry?.city || entry?.country);
  const parts = visible.flatMap((entry) =>
    [entry.city, entry.region, entry.country].filter(
      (part) => typeof part === "string" && part.trim()
    )
  );

  if (parts.length) return [...new Set(parts)].join(", ");

  // Older payloads expose flat country/city fields with proper place names
  // (verified: country: "India", city: "Bengaluru").
  const fallback = [row?.city, row?.country]
    .filter((part) => typeof part === "string" && part.trim())
    .join(", ");
  return fallback || "";
}

function rowCategory(row) {
  return (
    (typeof row?.department?.name === "string" && row.department.name) ||
    (typeof row?.function?.name === "string" && row.function.name) ||
    ""
  );
}

export async function fetchJobs({
  target,
  limit = 20,
  search = "",
  timeoutMs,
} = {}) {
  if (!target) {
    throw new SourceError(
      "missing_target",
      "A Workable account name is required"
    );
  }

  const payload = await fetchJson(boardUrl(target), { timeoutMs });

  if (!Array.isArray(payload?.jobs)) {
    throw new SourceError(
      "unexpected_payload",
      `Workable account "${target}" returned an unexpected response`
    );
  }

  const company = prettifyBoard(target);

  return payload.jobs
    .map((row) => {
      if (!row || !row.title) return null;

      return buildNormalizedJob({
        source: name,
        externalId: `${target}:${row.shortcode || row.code || row.id}`,
        title: row.title,
        company,
        description: row.description,
        applicationUrl: jobUrl(row, target),
        location: jobLocation(row),
        jobType: row.employment_type,
        remote: Boolean(row.telecommuting),
        postedAt: row.published_on || row.created_at,
        category: rowCategory(row),
      });
    })
    .filter(Boolean)
    .filter((job) => matchesSearch(job, search))
    .slice(0, limit);
}

export function resolveTargets(value) {
  return parseTargetParameter(value);
}
