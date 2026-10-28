// Compatibility layer for job discovery.
//
// The actual adapters live in ./jobSources. This module keeps the imports the
// rest of the app (and the existing tests) already use.

import { buildDedupeKey, Job } from "../models/Job.js";
import {
  clearJobsCache,
  discoverJobs,
  findDiscoveredJob,
} from "./jobSources/index.js";

export { discoverJobs, clearJobsCache };

export async function importDiscoveredJob({
  ownerId,
  source = "remotive",
  externalId,
  board,
}) {
  const found = await findDiscoveredJob({ source, externalId, board });
  const dedupeKey = buildDedupeKey(found);

  const existing = await Job.findOne({
    owner: ownerId,
    $or: [
      { dedupeKey },
      { source: found.source, externalId: found.externalId },
    ],
  });

  if (existing) return { job: existing, created: false };

  try {
    const job = await Job.create({ ...found, owner: ownerId, dedupeKey });
    return { job, created: true };
  } catch (error) {
    if (error?.code === 11000) {
      const job = await Job.findOne({ owner: ownerId, dedupeKey });
      if (job) return { job, created: false };
    }
    throw error;
  }
}

// Kept for backwards compatibility with existing callers.
export async function importRemotiveJob({ ownerId, externalId }) {
  return importDiscoveredJob({ ownerId, source: "remotive", externalId });
}
