import { env } from "../../config/env.js";
import { fetchJson, SourceError } from "./httpClient.js";
import { buildNormalizedJob } from "./normalize.js";

export const name = "remotive";
export const label = "Remotive";
export const attribution =
  "Live listings provided by Remotive (https://remotive.com)";
export const requiresTarget = false;

/**
 * Remotive keeps the exact request/response behavior the app shipped with:
 * search and limit are forwarded, jobs without an id are dropped, and the
 * application URL must be http(s).
 */
export async function fetchJobs({ search = "", limit = 20, timeoutMs } = {}) {
  const url = new URL(env.JOBS_API_URL);
  if (search) url.searchParams.set("search", search);
  url.searchParams.set("limit", String(limit));

  const payload = await fetchJson(url, { timeoutMs });

  if (!Array.isArray(payload?.jobs)) {
    throw new SourceError(
      "unexpected_payload",
      "Remotive returned an unexpected response"
    );
  }

  return payload.jobs
    .map((raw) => {
      if (!raw || raw.id === undefined || raw.id === null) return null;

      return buildNormalizedJob({
        source: name,
        externalId: raw.id,
        title: raw.title,
        company: raw.company_name,
        description: raw.description,
        applicationUrl: raw.url,
        location: raw.candidate_required_location || "Remote",
        jobType: raw.job_type,
        remote: true,
        postedAt: raw.publication_date,
        category: raw.category,
        salary: raw.salary,
      });
    })
    .filter(Boolean)
    .slice(0, limit);
}
