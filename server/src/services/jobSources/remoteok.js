// Remote OK public JSON feed (https://remoteok.com/api).
//
// The feed is public and its terms ask for two things that are honored here:
// link back to Remote OK and mention it as the source (see `attribution`),
// and never misrepresent the data. The first array element is a legal notice
// object, not a job, and is filtered out below.

import { fetchJson, SourceError } from "./httpClient.js";
import {
  buildNormalizedJob,
  matchesSearch,
  sanitizeUrl,
} from "./normalize.js";

export const name = "remoteok";
export const label = "Remote OK";
export const attribution =
  "Remote job listings provided by Remote OK (https://remoteok.com)";
export const requiresTarget = false;

const API_URL = "https://remoteok.com/api";

function salaryText(raw) {
  const min = Number(raw.salary_min) || 0;
  const max = Number(raw.salary_max) || 0;
  if (!min && !max) return "";

  const range = [min, max].filter(Boolean).join("-");
  return `USD ${range}`.trim();
}

export async function fetchJobs({ search = "", limit = 20, timeoutMs } = {}) {
  // The feed has no server-side search parameter, so filtering happens on the
  // normalized results below, exactly like the Jobicy adapter.
  const payload = await fetchJson(new URL(API_URL), { timeoutMs });

  if (!Array.isArray(payload)) {
    throw new SourceError(
      "unexpected_payload",
      "Remote OK returned an unexpected response"
    );
  }

  return payload
    .filter((raw) => raw && raw.position && raw.company)
    .map((raw) => {
      const tags = Array.isArray(raw.tags) ? raw.tags : [];
      const internship = tags.some((tag) => /intern|trainee/i.test(String(tag)));

      // apply_url points at the employer's form when one exists; otherwise the
      // Remote OK listing page is the application entry point.
      const applicationUrl = sanitizeUrl(raw.apply_url) || sanitizeUrl(raw.url);

      return buildNormalizedJob({
        source: name,
        externalId: raw.id ?? raw.slug,
        title: raw.position,
        company: raw.company,
        description: raw.description,
        applicationUrl,
        location: String(raw.location ?? "").trim() || "Remote",
        jobType: internship ? "internship" : undefined,
        remote: true,
        postedAt: raw.date || raw.epoch,
        category: tags.join(", "),
        salary: salaryText(raw),
      });
    })
    .filter(Boolean)
    .filter((job) => matchesSearch(job, search))
    .slice(0, limit);
}
