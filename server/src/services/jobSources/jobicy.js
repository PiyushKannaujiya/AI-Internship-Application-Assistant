import { fetchJson, SourceError } from "./httpClient.js";
import { buildNormalizedJob, matchesSearch } from "./normalize.js";

export const name = "jobicy";
export const label = "Jobicy";
export const attribution = "Remote listings provided by Jobicy (https://jobicy.com)";
export const requiresTarget = false;

const API_URL = "https://jobicy.com/api/v2/remote-jobs";

function salaryText(raw) {
  const min = raw.annualSalaryMin;
  const max = raw.annualSalaryMax;
  const currency = raw.salaryCurrency || "";
  if (!min && !max) return "";

  const range = [min, max].filter(Boolean).join("-");
  return `${currency} ${range}`.trim();
}

export async function fetchJobs({ search = "", limit = 20, timeoutMs } = {}) {
  const url = new URL(API_URL);
  url.searchParams.set("count", String(Math.min(50, Math.max(limit, 10))));

  const payload = await fetchJson(url, { timeoutMs });

  if (!Array.isArray(payload?.jobs)) {
    throw new SourceError(
      "unexpected_payload",
      "Jobicy returned an unexpected response"
    );
  }

  return payload.jobs
    .map((raw) => {
      if (!raw || !raw.id) return null;

      const industry = Array.isArray(raw.jobIndustry)
        ? raw.jobIndustry.join(", ")
        : raw.jobIndustry;

      return buildNormalizedJob({
        source: name,
        externalId: raw.id,
        title: raw.jobTitle,
        company: raw.companyName,
        description: raw.jobDescription || raw.jobExcerpt,
        applicationUrl: raw.url,
        location:
          /^anywhere$/i.test(String(raw.jobGeo ?? "").trim())
            ? "Remote"
            : raw.jobGeo,
        jobType: raw.jobType,
        remote: /anywhere|remote|worldwide/i.test(String(raw.jobGeo ?? "")),
        postedAt: raw.pubDate,
        category: industry || raw.jobLevel,
        salary: salaryText(raw),
      });
    })
    .filter(Boolean)
    .filter((job) => matchesSearch(job, search))
    .slice(0, limit);
}
