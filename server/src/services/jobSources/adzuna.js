// Adzuna adapter: official, documented public job-search API.
//
// Adzuna publishes a free search API (https://api.adzuna.com) that covers
// India (country=in), which makes it the first genuinely permitted live source
// for Indian internships and entry-level jobs in this app. Credentials come
// from the owner's Adzuna developer account via ADZUNA_APP_ID / ADZUNA_APP_KEY;
// without them the source is skipped with a stable `not_configured` code the
// same way company-board sources are skipped without board names.
//
// Failures follow the same client-safe SourceError contract as every other
// adapter so one bad source never hides the results of the others.

import { env } from "../../config/env.js";
import { fetchJson, SourceError } from "./httpClient.js";
import { buildNormalizedJob } from "./normalize.js";

export const name = "adzuna";
export const label = "Adzuna (official India jobs API)";
export const attribution = "Job data by Adzuna (adzuna.com)";
export const requiresTarget = false;
export const requiresKey = true; // ADZUNA_APP_ID + ADZUNA_APP_KEY

const API_BASE = "https://api.adzuna.com/v1/api/jobs";
const MAX_DAYS_OLD = "30";
const MAX_PER_PAGE = 50;
const MAX_PAGES = 5;
const DEFAULT_LIMIT = 20;
const MIN_TOTAL = 1;
const MAX_TOTAL = 100;

// Injection point used only by tests: production callers do not pass config.
export function credentials(config = {}) {
  return {
    appId: String(
      config.appId ?? env.ADZUNA_APP_ID ?? ""
    ).trim(),
    appKey: String(
      config.appKey ?? env.ADZUNA_APP_KEY ?? ""
    ).trim(),
    country: String(
      config.country ?? env.ADZUNA_COUNTRY ?? "in"
    )
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, ""),
  };
}

export function isConfigured() {
  const { appId, appKey } = credentials();
  return Boolean(appId && appKey);
}

function mapJobType(result) {
  // Adzuna tags contracts, not internships, so internships fall through to
  // "other" and honesty beats inventing a type the source did not report.
  const contractType = String(result?.contract_type || "").toLowerCase();
  const contractTime = String(result?.contract_time || "").toLowerCase();

  if (contractTime === "part_time") return "part-time";
  if (contractType === "contract") return "contract";
  if (contractType === "temporary") return "temporary";
  if (contractTime === "full_time" || contractType === "permanent") {
    return "full-time";
  }
  return "other";
}

const CURRENCY_SYMBOLS = {
  INR: "\u20b9",
  USD: "$",
  GBP: "\u00a3",
  EUR: "\u20ac",
  AUD: "A$",
  CAD: "C$",
};

function currencyAmount(value, symbol) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return `${symbol ?? ""}${Math.round(
    number <= 1000 ? number : number / 1000
  )}${number > 1000 ? "k" : ""}`;
}

function mapSalary(result) {
  const currency = String(result?.salary_currency || "").toUpperCase();
  const symbol = CURRENCY_SYMBOLS[currency];
  const min = currencyAmount(result?.salary_min, symbol);
  const max = currencyAmount(result?.salary_max, symbol);

  if (!min && !max) return "";
  if (min && max && min !== max) return `${min}\u2013${max}`;
  return max || min;
}

function mapLocation(result) {
  const area = Array.isArray(result?.location?.area)
    ? result.location.area.filter(Boolean)
    : [];
  const displayName = String(result?.location?.display_name || "").trim();
  return displayName || area.join(", ");
}

export async function fetchJobs({
  search = "",
  limit = 20,
  timeoutMs = env.JOB_SOURCE_TIMEOUT_MS,
  config = {},
} = {}) {
  const { appId, appKey, country } = credentials(config);
  if (!appId || !appKey) {
    throw new SourceError(
      "not_configured",
      "Adzuna credentials are not set. Add ADZUNA_APP_ID and ADZUNA_APP_KEY to enable this source."
    );
  }

  // Adzuna indexes are addressed by ISO 3166-1 alpha-2 country codes (in, us,
  // gb...). Anything else is setup corruption, not a transient failure.
  if (!/^[a-z]{2}$/.test(country)) {
    throw new SourceError(
      "not_configured",
      "ADZUNA_COUNTRY must be a 2-letter country code, e.g. in"
    );
  }

  const wanted = Math.max(
    MIN_TOTAL,
    Math.min(MAX_TOTAL, Math.max(1, Number(limit) || DEFAULT_LIMIT))
  );
  const perPage = Math.min(MAX_PER_PAGE, wanted);

  const buildUrl = (page) => {
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: String(perPage),
      max_days_old: MAX_DAYS_OLD,
      sort_by: "date",
    });

    const keyword = String(search || "").trim();
    if (keyword) params.set("what", keyword);

    return `${API_BASE}/${country}/search/${page}?${params.toString()}`;
  };

  // The free tier serves at most MAX_PER_PAGE results per request, and import
  // by provider id asks for more than one page (findDiscoveredJob uses 100),
  // so walk pages until the wanted count is collected or the feed ends.
  const found = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await fetchJson(buildUrl(page), { timeoutMs });
    const results = Array.isArray(data?.results) ? data.results : [];

    for (const result of results) {
      const job = buildNormalizedJob({
        source: name,
        externalId: result?.id,
        title: result?.title,
        company: result?.company?.display_name,
        description: result?.description,
        applicationUrl: result?.redirect_url,
        location: mapLocation(result),
        jobType: mapJobType(result),
        remote: false,
        postedAt: result?.created,
        category: result?.category?.label,
        salary: mapSalary(result),
      });
      if (job) found.push(job);
      if (found.length >= wanted) break;
    }

    if (
      found.length >= wanted ||
      results.length < perPage ||
      results.length === 0
    ) {
      break;
    }
  }

  return found;
}
