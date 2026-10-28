// Job source registry and multi-source discovery.
//
// Design rules:
// - Every adapter is independent: one failing provider never hides the results
//   of another.
// - A failure is reported as data (source, code, message), never thrown across
//   the whole request.
// - Only when *every* requested source fails do we return 503, which is what
//   the single-source behavior always did.

import { env } from "../../config/env.js";
import { ApiError } from "../../utils/ApiError.js";
import { SourceError } from "./httpClient.js";
import {
  dedupeJobs,
  matchesLocation,
  sortIndiaFirst,
} from "./normalize.js";
import * as remotive from "./remotive.js";
import * as jobicy from "./jobicy.js";
import * as arbeitnow from "./arbeitnow.js";
import * as greenhouse from "./greenhouse.js";
import * as lever from "./lever.js";
import * as ashby from "./ashby.js";
import * as remoteok from "./remoteok.js";
import * as adzuna from "./adzuna.js";
import * as workable from "./workable.js";
import * as smartrecruiters from "./smartrecruiters.js";
import { listSearchShortcuts } from "./shortcuts.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

const ADAPTERS = [
  remotive,
  jobicy,
  arbeitnow,
  greenhouse,
  lever,
  ashby,
  remoteok,
  adzuna,
  workable,
  smartrecruiters,
];

const REGISTRY = new Map(ADAPTERS.map((adapter) => [adapter.name, adapter]));

const TARGET_ENV = {
  greenhouse: "GREENHOUSE_BOARDS",
  lever: "LEVER_SITES",
  ashby: "ASHBY_ORGS",
  workable: "WORKABLE_ACCOUNTS",
  smartrecruiters: "SMARTRECRUITERS_BOARDS",
};

function splitList(value) {
  const raw = Array.isArray(value) ? value.join(",") : value;
  if (!raw) return [];
  return [
    ...new Set(
      String(raw)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    ),
  ];
}

function resolveSourceNames(value) {
  const requested = splitList(value);
  const names = requested.length ? requested : splitList(env.JOB_DISCOVERY_SOURCES);

  if (!names.length) {
    throw ApiError.badRequest(
      "No job sources are configured. Set JOB_DISCOVERY_SOURCES."
    );
  }

  const unknown = names.filter((name) => !REGISTRY.has(name));
  if (unknown.length) {
    throw ApiError.badRequest(
      `Unknown job source: ${unknown.join(", ")}. Supported sources: ${[
        ...REGISTRY.keys(),
      ].join(", ")}`
    );
  }

  return names;
}

function resolveTargets(sourceName, boards) {
  const queryValue = boards?.[sourceName];
  if (queryValue) return splitList(queryValue);

  const envValue = env[TARGET_ENV[sourceName]];
  if (splitList(envValue).length) return splitList(envValue);

  // Frankly configurable adapters ship a live-verified default board list so
  // India-first discovery works out of the box; the query/env values above
  // still override it.
  return splitList(REGISTRY.get(sourceName)?.DEFAULT_TARGETS);
}

function withHardTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new SourceError(
          "timeout",
          "The job source did not respond in time"
        )
      );
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function toClientError(error) {
  if (error instanceof SourceError) {
    return { code: error.code, message: error.message };
  }

  return {
    code: "source_error",
    message: "The job source could not be read",
  };
}

async function runAdapter(adapter, { search, target, limit, timeoutMs }) {
  const startedAt = Date.now();

  try {
    const jobs = await withHardTimeout(
      adapter.fetchJobs({ search, target, limit, timeoutMs }),
      timeoutMs + 1000
    );

    return {
      name: adapter.name,
      label: adapter.label,
      target: target ?? null,
      status: "ok",
      count: jobs.length,
      jobs,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name: adapter.name,
      label: adapter.label,
      target: target ?? null,
      status: "failed",
      count: 0,
      jobs: [],
      durationMs: Date.now() - startedAt,
      error: toClientError(error),
    };
  }
}

// Round-robin the merged results so a single prolific source cannot fill the
// whole first page while other healthy sources stay invisible.
function interleaveBySource(jobs, order) {
  const buckets = new Map(order.map((name) => [name, []]));

  for (const job of jobs) {
    if (!buckets.has(job.source)) buckets.set(job.source, []);
    buckets.get(job.source).push(job);
  }

  const merged = [];
  let index = 0;
  let added = true;

  while (added) {
    added = false;
    for (const bucket of buckets.values()) {
      if (bucket[index]) {
        merged.push(bucket[index]);
        added = true;
      }
    }
    index += 1;
  }

  return merged;
}

function buildTasks(names, boards) {
  const tasks = [];

  for (const sourceName of names) {
    const adapter = REGISTRY.get(sourceName);

    if (!adapter.requiresTarget) {
      // Keyed sources (Adzuna) are skipped, not failed, when credentials are
      // absent so an unconfigured optional source never reads as an outage.
      if (adapter.requiresKey && !adapter.isConfigured()) {
        tasks.push({ adapter, target: null, skipped: true });
        continue;
      }

      tasks.push({ adapter, target: null });
      continue;
    }

    const targets = resolveTargets(sourceName, boards);
    if (!targets.length) {
      tasks.push({ adapter, target: null, skipped: true });
      continue;
    }

    for (const target of targets) tasks.push({ adapter, target });
  }

  return tasks;
}

export function availableSources() {
  return [...REGISTRY.values()].map((adapter) => ({
    name: adapter.name,
    label: adapter.label,
    requiresTarget: Boolean(adapter.requiresTarget),
    configuredTargets: adapter.requiresTarget
      ? resolveTargets(adapter.name)
      : [],
    requiresKey: Boolean(adapter.requiresKey),
    configured: adapter.requiresKey ? Boolean(adapter.isConfigured()) : undefined,
  }));
}

// The controller may pass `remote` as a query string; normalize it once so
// filtering and caching only ever see a boolean or undefined.
function normalizeRemoteFlag(remote) {
  if (remote === undefined || remote === null || remote === "") return undefined;
  return remote === true || remote === "true";
}

export async function discoverJobs({
  search = "",
  limit = 20,
  sources,
  boards,
  location = "",
  remote,
  jobType,
  timeoutMs = env.JOB_SOURCE_TIMEOUT_MS,
} = {}) {
  const names = resolveSourceNames(sources);
  const tasks = buildTasks(names, boards);
  const wantRemote = normalizeRemoteFlag(remote);
  const wantLocation = String(location ?? "").trim();

  const cacheKey = JSON.stringify({
    sources: names,
    targets: tasks.map((task) => `${task.adapter.name}:${task.target ?? ""}`),
    search: String(search).toLowerCase(),
    location: wantLocation.toLowerCase(),
    remote: wantRemote ?? null,
    jobType: jobType ?? null,
    limit,
  });

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.value, cached: true };
  }

  const perSourceLimit =
    names.length === 1 ? limit : Math.min(50, Math.max(limit * 2, 20));

  const results = await Promise.all(
    tasks.map(async ({ adapter, target, skipped }) => {
      if (skipped) {
        return {
          name: adapter.name,
          label: adapter.label,
          target: null,
          status: "skipped",
          count: 0,
          jobs: [],
          durationMs: 0,
          error: {
            // Board sources skipped without targets keep the historical code;
            // keyed sources skipped without credentials report not_configured.
            code: adapter.requiresKey
              ? "not_configured"
              : "no_targets_configured",
            message: `${adapter.label} is not configured and was skipped. See the source setup notes.`,
          },
        };
      }

      return runAdapter(adapter, {
        search,
        target,
        limit: perSourceLimit,
        timeoutMs,
      });
    })
  );

  const usable = results.filter((result) => result.status === "ok");
  const failed = results.filter((result) => result.status === "failed");

  if (!usable.length) {
    const detail = {
      sources: results.map((result) => ({
        source: result.name,
        target: result.target,
        code: result.error?.code,
      })),
    };

    if (failed.length) {
      throw ApiError.serviceUnavailable(
        "The live job sources are unreachable or unavailable right now. You can still add jobs manually or import one from a URL.",
        detail
      );
    }

    throw ApiError.badRequest(
      "None of the requested job sources have boards configured. Add a board name or choose another source.",
      detail
    );
  }

  // Filters run after cross-source deduplication so a narrow query (e.g.
  // location=india) can still draw from every healthy source. An empty result
  // is a normal "no matches" answer, not an error.
  const filtered = dedupeJobs(usable.flatMap((result) => result.jobs)).filter(
    (job) =>
      matchesLocation(job, wantLocation) &&
      (wantRemote === undefined || Boolean(job.remote) === wantRemote) &&
      (!jobType || job.jobType === jobType)
  );

  // Without an explicit location the user gets an India-first ranking: the
  // round-robin order inside each group is preserved, matching Indian
  // listings are just surfaced first. With an explicit location the filter has
  // already applied the user's intent, so ordering is left alone.
  const ordered = wantLocation
    ? interleaveBySource(filtered, names)
    : sortIndiaFirst(interleaveBySource(filtered, names));

  const jobs = ordered.slice(0, limit);

  const attribution = [
    ...new Set(usable.map((result) => REGISTRY.get(result.name).attribution)),
  ].join(" | ");

  // Compliant fallbacks for platforms without a permitted listing API: the
  // client opens these prefilled searches on the platform itself. Returned
  // alongside live results and never merged into them.
  const shortcuts = listSearchShortcuts({
    search,
    location: wantLocation,
    jobType: jobType || "",
    remote: wantRemote,
  });

  const value = {
    jobs,
    total: jobs.length,
    searchedAt: new Date().toISOString(),
    source: names.length === 1 ? names[0] : "multi",
    shortcuts,
    sources: results.map((result) => ({
      source: result.name,
      label: result.label,
      target: result.target,
      status: result.status,
      count: result.count,
      durationMs: result.durationMs,
      ...(result.error ? { error: result.error } : {}),
    })),
    errors: failed.map((result) => ({
      source: result.name,
      target: result.target,
      code: result.error?.code,
      message: result.error?.message,
    })),
    attribution,
    filters: {
      location: wantLocation || null,
      remote: wantRemote ?? null,
      jobType: jobType || null,
    },
    availableSources: availableSources(),
  };

  // Partial failures are returned to the caller but never cached as if clean.
  if (!failed.length) cache.set(cacheKey, { at: Date.now(), value });

  return { ...value, cached: false };
}

/**
 * Fetch a single source again and return the listing matching `externalId`.
 * Used by the import endpoint so a client cannot submit arbitrary job data.
 */
export async function findDiscoveredJob({
  source = "remotive",
  externalId,
  board,
  timeoutMs = env.JOB_SOURCE_TIMEOUT_MS,
}) {
  const adapter = REGISTRY.get(source);
  if (!adapter) {
    throw ApiError.badRequest(
      `Unknown job source: ${source}. Supported sources: ${[
        ...REGISTRY.keys(),
      ].join(", ")}`
    );
  }

  if (!externalId) {
    throw ApiError.badRequest("An external job id is required");
  }

  const id = String(externalId);
  let target = board || null;

  if (adapter.requiresTarget && !target && id.includes(":")) {
    target = id.slice(0, id.indexOf(":"));
  }

  if (adapter.requiresTarget && !target) {
    throw ApiError.badRequest(
      `Importing from ${adapter.label} requires a board name`
    );
  }

  let jobs;
  try {
    jobs = await withHardTimeout(
      adapter.fetchJobs({ search: "", target, limit: 100, timeoutMs }),
      timeoutMs + 1000
    );
  } catch (error) {
    throw ApiError.serviceUnavailable(
      `${adapter.label} is unreachable right now. You can still add this job manually or import it from its URL.`,
      { reason: toClientError(error).code }
    );
  }

  // Board sources store "board:id"; accept either the prefixed id or the raw
  // provider id when the board was supplied explicitly.
  const found = jobs.find(
    (job) =>
      job.externalId === id ||
      (target && job.externalId === `${target}:${id}`)
  );

  if (!found) {
    throw ApiError.notFound(
      "That listing is no longer available from the job source"
    );
  }

  return found;
}

export function clearJobsCache() {
  cache.clear();
}

export { REGISTRY, ADAPTERS, CACHE_TTL_MS };
