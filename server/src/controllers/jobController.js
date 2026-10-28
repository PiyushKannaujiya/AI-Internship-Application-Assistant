import { APPLICATION_STATUSES, Application } from "../models/Application.js";
import { Job, buildDedupeKey } from "../models/Job.js";
import { Resume } from "../models/Resume.js";
import { recordActivity } from "../services/activity.js";
import {
  discoverJobs,
  importDiscoveredJob,
} from "../services/jobsProvider.js";
import { importJobFromUrl } from "../services/urlImport/index.js";
import { buildMatch } from "../services/matching.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function paginationMeta({ page, limit, total }) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

function withApplication(job, application) {
  return {
    ...job.toJSON(),
    applicationId: application?.id || null,
    applicationStatus: application?.status || null,
  };
}

async function loadResume(ownerId) {
  return Resume.findOne({ owner: ownerId }).select("+text");
}

async function ensureApplication(ownerId, job) {
  const existing = await Application.findOne({ owner: ownerId, job: job._id });
  if (existing) return existing;

  return Application.create({
    owner: ownerId,
    job: job._id,
    status: "saved",
    statusHistory: [{ status: "saved", at: new Date() }],
  });
}

export const listJobs = asyncHandler(async (req, res) => {
  const query = req.validatedQuery;
  const owner = req.user._id;
  const filter = { owner };

  if (query.q) {
    const pattern = new RegExp(escapeRegex(query.q.slice(0, 100)), "i");
    filter.$or = [
      { title: pattern },
      { company: pattern },
      { description: pattern },
      { skills: pattern },
    ];
  }

  if (query.location) {
    filter.location = new RegExp(escapeRegex(query.location.slice(0, 100)), "i");
  }

  if (query.jobType) filter.jobType = query.jobType;
  if (query.remote) filter.remote = query.remote === "true";
  if (query.source) filter.source = query.source;

  if (query.status) {
    const jobIds = await Application.distinct("job", {
      owner,
      status: query.status,
    });

    if (jobIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: { jobs: [] },
        meta: paginationMeta({ page: query.page, limit: query.limit, total: 0 }),
      });
    }

    filter._id = { $in: jobIds };
  }

  const sortMap = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    title: { title: 1 },
    company: { company: 1 },
    postedAt: { postedAt: -1, createdAt: -1 },
  };

  const skip = (query.page - 1) * query.limit;

  const [jobs, total] = await Promise.all([
    Job.find(filter).sort(sortMap[query.sort]).skip(skip).limit(query.limit),
    Job.countDocuments(filter),
  ]);

  const applications = await Application.find({
    owner,
    job: { $in: jobs.map((job) => job._id) },
  }).select("job status");

  const byJobId = new Map(
    applications.map((application) => [
      application.job.toString(),
      application,
    ])
  );

  res.status(200).json({
    success: true,
    data: {
      jobs: jobs.map((job) =>
        withApplication(job, byJobId.get(job._id.toString()))
      ),
    },
    meta: paginationMeta({ page: query.page, limit: query.limit, total }),
  });
});

export const getJob = asyncHandler(async (req, res) => {
  const job = await Job.findOne({ _id: req.params.id, owner: req.user._id });
  if (!job) throw ApiError.notFound("Job not found");

  const [application, resume] = await Promise.all([
    Application.findOne({ owner: req.user._id, job: job._id }),
    loadResume(req.user._id),
  ]);

  const match = buildMatch({ job, user: req.user, resume });

  res.status(200).json({
    success: true,
    data: {
      job: withApplication(job, application),
      application: application ? application.toJSON() : null,
      match,
      resumeUsed: Boolean(resume),
    },
  });
});

export const createJob = asyncHandler(async (req, res) => {
  const payload = req.body;
  const dedupeKey = buildDedupeKey(payload);

  const existing = await Job.findOne({ owner: req.user._id, dedupeKey });
  if (existing) {
    throw ApiError.conflict("This job is already in your list", {
      jobId: existing.id,
    });
  }

  let job;
  try {
    job = await Job.create({
      ...payload,
      owner: req.user._id,
      source: payload.source || "manual",
      dedupeKey,
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw ApiError.conflict("This job is already in your list");
    }
    throw error;
  }

  const application = await Application.create({
    owner: req.user._id,
    job: job._id,
    status: "saved",
    statusHistory: [{ status: "saved", at: new Date() }],
  });

  await recordActivity({
    owner: req.user._id,
    type: "job_created",
    message: `Added ${job.title} at ${job.company}`,
    job: job._id,
  });

  res.status(201).json({
    success: true,
    data: { job: withApplication(job, application) },
  });
});

export const updateJob = asyncHandler(async (req, res) => {
  const updates = { ...req.body };

  if (updates.applicationUrl) {
    updates.dedupeKey = buildDedupeKey({
      ...updates,
      company: updates.company,
      title: updates.title,
    });
  }

  const job = await Job.findOne({ _id: req.params.id, owner: req.user._id });
  if (!job) throw ApiError.notFound("Job not found");

  Object.assign(job, updates);

  try {
    await job.save();
  } catch (error) {
    if (error?.code === 11000) {
      throw ApiError.conflict("Another saved job already uses that URL");
    }
    throw error;
  }

  const application = await Application.findOne({
    owner: req.user._id,
    job: job._id,
  });

  res.status(200).json({
    success: true,
    data: { job: withApplication(job, application) },
  });
});

export const deleteJob = asyncHandler(async (req, res) => {
  const job = await Job.findOneAndDelete({
    _id: req.params.id,
    owner: req.user._id,
  });

  if (!job) throw ApiError.notFound("Job not found");

  await Application.deleteMany({ owner: req.user._id, job: job._id });

  res.status(200).json({
    success: true,
    data: { message: "Job and its tracking record were deleted" },
  });
});

export const saveJob = asyncHandler(async (req, res) => {
  const job = await Job.findOne({ _id: req.params.id, owner: req.user._id });
  if (!job) throw ApiError.notFound("Job not found");

  let application = await Application.findOne({
    owner: req.user._id,
    job: job._id,
  });

  let created = false;

  if (!application) {
    try {
      application = await Application.create({
        owner: req.user._id,
        job: job._id,
        status: "saved",
        statusHistory: [{ status: "saved", at: new Date() }],
      });
      created = true;
      await recordActivity({
        owner: req.user._id,
        type: "job_saved",
        message: `Saved ${job.title} at ${job.company}`,
        job: job._id,
      });
    } catch (error) {
      if (error?.code === 11000) {
        application = await Application.findOne({
          owner: req.user._id,
          job: job._id,
        });
      } else {
        throw error;
      }
    }
  }

  res.status(created ? 201 : 200).json({
    success: true,
    data: { job: withApplication(job, application) },
  });
});

export const unsaveJob = asyncHandler(async (req, res) => {
  const job = await Job.findOne({ _id: req.params.id, owner: req.user._id });
  if (!job) throw ApiError.notFound("Job not found");

  const application = await Application.findOne({
    owner: req.user._id,
    job: job._id,
  });

  if (!application) throw ApiError.notFound("This job is not saved");

  if (application.status !== "saved") {
    throw ApiError.conflict(
      "This application is already in progress. Change its status instead of removing it."
    );
  }

  await application.deleteOne();

  res.status(200).json({
    success: true,
    data: { message: "Job removed from saved jobs" },
  });
});

export const matchJob = asyncHandler(async (req, res) => {
  const job = await Job.findOne({ _id: req.params.id, owner: req.user._id });
  if (!job) throw ApiError.notFound("Job not found");

  const resume = await loadResume(req.user._id);
  const match = buildMatch({ job, user: req.user, resume });

  res.status(200).json({
    success: true,
    data: { jobId: job.id, match, resumeUsed: Boolean(resume) },
  });
});

export const discover = asyncHandler(async (req, res) => {
  const {
    search,
    location,
    remote,
    jobType,
    limit,
    sources,
    greenhouse,
    lever,
    ashby,
    workable,
    smartrecruiters,
  } = req.validatedQuery;

  const result = await discoverJobs({
    search,
    location,
    remote,
    jobType,
    limit,
    sources,
    boards: { greenhouse, lever, ashby, workable, smartrecruiters },
  });

  res.status(200).json({
    success: true,
    data: result,
    meta: {
      provider: result.source,
      cacheTtlSeconds: 300,
      note: "Live listings are fetched server-side. Import a listing to save and track it.",
    },
  });
});

export const importJob = asyncHandler(async (req, res) => {
  const { externalId, source, board } = req.body;
  const { job, created } = await importDiscoveredJob({
    ownerId: req.user._id,
    source,
    externalId,
    board,
  });

  const application = await ensureApplication(req.user._id, job);

  if (created) {
    await recordActivity({
      owner: req.user._id,
      type: "job_saved",
      message: `Imported ${job.title} at ${job.company}`,
      job: job._id,
    });
  }

  res.status(created ? 201 : 200).json({
    success: true,
    data: { job: withApplication(job, application), created },
  });
});

/**
 * Import a job from a public URL. Returns a reviewable draft by default and
 * only stores anything when the client explicitly asks to save it.
 */
export const importUrl = asyncHandler(async (req, res) => {
  const { url, save } = req.body;
  const result = await importJobFromUrl(url);

  if (!result.extracted || !result.job) {
    return res.status(200).json({
      success: true,
      data: { ...result, saved: false, created: false, jobSaved: null },
    });
  }

  if (!save) {
    return res.status(200).json({
      success: true,
      data: { ...result, saved: false, created: false, jobSaved: null },
    });
  }

  const record = { ...result.job, source: "url" };
  const dedupeKey = buildDedupeKey(record);

  let job = await Job.findOne({ owner: req.user._id, dedupeKey });
  let created = false;

  if (!job) {
    try {
      job = await Job.create({ ...record, owner: req.user._id, dedupeKey });
      created = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      job = await Job.findOne({ owner: req.user._id, dedupeKey });
    }
  }

  if (!job) {
    throw ApiError.conflict("This job is already in your list");
  }

  const application = await ensureApplication(req.user._id, job);

  if (created) {
    await recordActivity({
      owner: req.user._id,
      type: "job_saved",
      message: `Imported ${job.title} at ${job.company} from a URL`,
      job: job._id,
    });
  }

  res.status(created ? 201 : 200).json({
    success: true,
    data: {
      ...result,
      saved: true,
      created,
      jobSaved: withApplication(job, application),
    },
  });
});

export const statusList = Object.freeze(APPLICATION_STATUSES);
