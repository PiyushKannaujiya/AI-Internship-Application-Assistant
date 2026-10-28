import { fetchJson, parseTargetParameter, SourceError } from "./httpClient.js";
import { buildNormalizedJob, matchesSearch } from "./normalize.js";

export const name = "greenhouse";
export const label = "Greenhouse job boards";
export const attribution =
  "Listings read from public Greenhouse job boards (https://boards.greenhouse.io)";
export const requiresTarget = true;

function prettifyBoard(target) {
  return target
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function metadataValue(raw, pattern) {
  const entries = Array.isArray(raw.metadata) ? raw.metadata : [];
  const match = entries.find((entry) => pattern.test(String(entry?.name ?? "")));
  return match?.value ? String(match.value) : "";
}

export function boardUrl(target) {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
    target
  )}/jobs?content=true`;
}

export async function fetchJobs({ target, limit = 20, search = "", timeoutMs } = {}) {
  if (!target) {
    throw new SourceError("missing_target", "A Greenhouse board name is required");
  }

  const payload = await fetchJson(boardUrl(target), { timeoutMs });

  if (!Array.isArray(payload?.jobs)) {
    throw new SourceError(
      "unexpected_payload",
      `Greenhouse board "${target}" returned an unexpected response`
    );
  }

  const company = prettifyBoard(target);

  return payload.jobs
    .map((raw) => {
      if (!raw || raw.id === undefined || !raw.title) return null;

      const location = raw.location?.name || "";
      const employmentType =
        metadataValue(raw, /employment type|job type/i) || "";

      return buildNormalizedJob({
        source: name,
        externalId: `${target}:${raw.id}`,
        title: raw.title,
        company,
        description: raw.content,
        applicationUrl: raw.absolute_url,
        location,
        jobType: employmentType,
        remote:
          /remote/i.test(location) ||
          /remote/i.test(metadataValue(raw, /location type/i)),
        postedAt: raw.updated_at,
        category: metadataValue(raw, /department|team/i),
      });
    })
    .filter(Boolean)
    .filter((job) => matchesSearch(job, search))
    .slice(0, limit);
}

export function resolveTargets(value) {
  return parseTargetParameter(value);
}
