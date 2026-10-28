import { fetchJson, parseTargetParameter, SourceError } from "./httpClient.js";
import { buildNormalizedJob, matchesSearch } from "./normalize.js";

export const name = "ashby";
export const label = "Ashby job boards";
export const attribution =
  "Listings read from public Ashby job boards (https://www.ashbyhq.com)";
export const requiresTarget = true;

function prettifyOrg(target) {
  return target
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function compensationText(compensation) {
  if (!compensation) return "";
  const summary =
    compensation.compensationTierSummary ||
    compensation.summary ||
    (Array.isArray(compensation.compensationTiers)
      ? compensation.compensationTiers
          .map((tier) => tier?.title || "")
          .filter(Boolean)
          .join(", ")
      : "");
  return String(summary || "").slice(0, 200);
}

export function boardUrl(org) {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
    org
  )}?includeCompensation=true`;
}

export async function fetchJobs({ target, limit = 20, search = "", timeoutMs } = {}) {
  if (!target) {
    throw new SourceError("missing_target", "An Ashby organization is required");
  }

  const payload = await fetchJson(boardUrl(target), { timeoutMs });

  if (!Array.isArray(payload?.jobs)) {
    throw new SourceError(
      "unexpected_payload",
      `Ashby board "${target}" returned an unexpected response`
    );
  }

  const company = prettifyOrg(target);

  return payload.jobs
    .map((raw) => {
      if (!raw || !raw.id || !raw.title) return null;

      return buildNormalizedJob({
        source: name,
        externalId: `${target}:${raw.id}`,
        title: raw.title,
        company,
        description: raw.descriptionHtml || raw.descriptionPlain,
        applicationUrl: raw.jobUrl || raw.applyUrl,
        location: raw.location,
        jobType: raw.employmentType,
        remote: raw.isRemote === true || /remote/i.test(String(raw.workplaceType ?? "")),
        postedAt: raw.publishedAt,
        category: raw.department || raw.team,
        salary: compensationText(raw.compensation),
      });
    })
    .filter(Boolean)
    .filter((job) => matchesSearch(job, search))
    .slice(0, limit);
}

export function resolveTargets(value) {
  return parseTargetParameter(value);
}
