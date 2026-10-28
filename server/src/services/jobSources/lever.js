import { fetchJson, parseTargetParameter, SourceError } from "./httpClient.js";
import { buildNormalizedJob, matchesSearch } from "./normalize.js";

export const name = "lever";
export const label = "Lever job boards";
export const attribution =
  "Listings read from public Lever job boards (https://www.lever.co)";
export const requiresTarget = true;

function prettifySite(target) {
  return target
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

export function boardUrl(site) {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`;
}

export async function fetchJobs({ target, limit = 20, search = "", timeoutMs } = {}) {
  if (!target) {
    throw new SourceError("missing_target", "A Lever site name is required");
  }

  const payload = await fetchJson(boardUrl(target), { timeoutMs });

  if (!Array.isArray(payload)) {
    throw new SourceError(
      "unexpected_payload",
      `Lever site "${target}" returned an unexpected response`
    );
  }

  const company = prettifySite(target);

  return payload
    .map((raw) => {
      if (!raw || !raw.id || !raw.text) return null;

      const categories = raw.categories || {};
      const location =
        categories.location || (Array.isArray(categories.allLocations)
          ? categories.allLocations.join(", ")
          : "");

      return buildNormalizedJob({
        source: name,
        externalId: `${target}:${raw.id}`,
        title: raw.text,
        company,
        description:
          raw.descriptionPlain ||
          raw.description ||
          raw.lists?.map((list) => list.text).join("\n"),
        applicationUrl: raw.hostedUrl || raw.applyUrl,
        location,
        jobType: categories.commitment,
        remote: /remote/i.test(String(raw.workplaceType ?? location)),
        postedAt: raw.createdAt,
        category: categories.department || categories.team,
        salary: raw.salaryRange
          ? [raw.salaryRange.min, raw.salaryRange.max]
              .filter(Boolean)
              .join("-")
          : "",
      });
    })
    .filter(Boolean)
    .filter((job) => matchesSearch(job, search))
    .slice(0, limit);
}

export function resolveTargets(value) {
  return parseTargetParameter(value);
}
