import { fetchJson, SourceError } from "./httpClient.js";
import { buildNormalizedJob, matchesSearch } from "./normalize.js";

export const name = "arbeitnow";
export const label = "Arbeitnow";
export const attribution =
  "Job listings provided by Arbeitnow (https://www.arbeitnow.com)";
export const requiresTarget = false;

const API_URL = "https://www.arbeitnow.com/api/job-board-api";

export async function fetchJobs({ search = "", limit = 20, timeoutMs } = {}) {
  const url = new URL(API_URL);
  url.searchParams.set("page", "1");

  const payload = await fetchJson(url, { timeoutMs });

  if (!Array.isArray(payload?.data)) {
    throw new SourceError(
      "unexpected_payload",
      "Arbeitnow returned an unexpected response"
    );
  }

  return payload.data
    .map((raw) => {
      if (!raw || !raw.slug) return null;

      const tags = Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [];

      return buildNormalizedJob({
        source: name,
        externalId: raw.slug,
        title: raw.title,
        company: raw.company_name,
        // Include tags so skill extraction sees the stack even when the body is
        // short. The line is clearly labeled and stays at the end.
        description: tags.length
          ? `${raw.description}\n\nTags: ${tags.join(", ")}`
          : raw.description,
        applicationUrl: raw.url,
        location: raw.location || (raw.remote ? "Remote" : "Not specified"),
        jobType: raw.job_types?.[0],
        remote: raw.remote === true,
        postedAt: raw.created_at,
        category: tags.slice(0, 5).join(", "),
      });
    })
    .filter(Boolean)
    .filter((job) => matchesSearch(job, search))
    .slice(0, limit);
}
