import { Job } from "../models/Job.js";
import { Resume } from "../models/Resume.js";
import { TailoredResume } from "../models/TailoredResume.js";
import { recordActivity } from "../services/activity.js";
import { generateTailoredSummary } from "../services/ai.js";
import { buildMatch } from "../services/matching.js";
import {
  buildSourceResumeDiff,
  buildTailoredDiff,
  buildTailoredResume,
} from "../services/tailoredResume.js";
import { buildTailoredFiles } from "../services/tailoredResumeFiles.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

function serializeTailoredResume(document) {
  const data = document.toJSON();
  const downloads = {};
  for (const file of data.files || []) {
    downloads[file.format] = `/api/tailored-resumes/${data.id}/download/${file.format}`;
  }
  return {
    ...data,
    baseResumeId: String(document.baseResume),
    jobId: String(document.job),
    downloads,
  };
}

async function nextRevision(userId, jobId) {
  const latest = await TailoredResume.findOne({
    owner: userId,
    job: jobId,
  }).sort({ revision: -1 });
  return (latest?.revision || 0) + 1;
}

async function generateDocument({ user, job, resume, revision }) {
  const match = buildMatch({ job, user, resume });
  const tailored = buildTailoredResume({ user, job });
  const summary = await generateTailoredSummary({
    user,
    job,
    match,
    draftSummary: tailored.content.summary,
  });

  tailored.content.summary = summary.summary;

  const files = await buildTailoredFiles({
    content: tailored.content,
    user,
    job,
    revision,
  });

  const diff = buildTailoredDiff({
    content: tailored.content,
    profile: user.profile || {},
  });
  diff.sourceResume = buildSourceResumeDiff({
    resume,
    content: tailored.content,
  });

  return {
    content: tailored.content,
    changes: {
      ...tailored.changes,
      summary: {
        ...tailored.changes.summary,
        changed: diff.summary.changed,
      },
    },
    diff,
    files,
    provider: summary.provider,
    model: summary.model,
    notice: summary.notice,
  };
}

async function loadContext(userId, jobId) {
  const [job, resume] = await Promise.all([
    Job.findOne({ _id: jobId, owner: userId }),
    Resume.findOne({ owner: userId }).select("+text"),
  ]);

  if (!job) throw ApiError.notFound("Job not found");
  if (!resume) {
    throw ApiError.unprocessable(
      "Upload a resume before generating a tailored resume"
    );
  }

  return { job, resume };
}

export const createTailoredResume = asyncHandler(async (req, res) => {
  const { jobId } = req.body;
  const { job, resume } = await loadContext(req.user._id, jobId);

  let created = null;
  let lastError = null;

  // The unique (owner, job, revision) index protects against concurrent
  // generations; retry with the next revision instead of silently overwriting.
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    const revision = await nextRevision(req.user._id, job._id);
    const generated = await generateDocument({
      user: req.user,
      job,
      resume,
      revision,
    });

    try {
      created = await TailoredResume.create({
        owner: req.user._id,
        job: job._id,
        baseResume: resume._id,
        revision,
        status: "draft",
        ...generated,
      });
    } catch (error) {
      lastError = error;
      if (error?.code !== 11000) throw error;
    }
  }

  if (!created) {
    throw lastError || ApiError.conflict("Could not allocate a new revision");
  }

  await recordActivity({
    owner: req.user._id,
    type: "tailored_resume_generated",
    message: `Generated tailored resume revision ${created.revision} for ${job.title}`,
    job: job._id,
  });

  res.status(201).json({
    success: true,
    data: { tailoredResume: serializeTailoredResume(created) },
  });
});

export const listTailoredResumes = asyncHandler(async (req, res) => {
  const { jobId } = req.validatedQuery;
  const filter = { owner: req.user._id };
  if (jobId) filter.job = jobId;

  const resumes = await TailoredResume.find(filter)
    .sort({ createdAt: -1 })
    .limit(100);

  const latestByJob = new Map();
  for (const resume of resumes) {
    const key = String(resume.job);
    const current = latestByJob.get(key);
    if (!current || resume.revision > current) latestByJob.set(key, resume.revision);
  }

  res.status(200).json({
    success: true,
    data: {
      tailoredResumes: resumes.map((resume) => ({
        ...serializeTailoredResume(resume),
        isLatestRevision:
          latestByJob.get(String(resume.job)) === resume.revision,
      })),
    },
  });
});

export const getTailoredResume = asyncHandler(async (req, res) => {
  const resume = await TailoredResume.findOne({
    _id: req.params.id,
    owner: req.user._id,
  });

  if (!resume) throw ApiError.notFound("Tailored resume not found");

  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).json({
    success: true,
    data: {
      tailoredResume: serializeTailoredResume(resume),
    },
  });
});

export const updateTailoredResume = asyncHandler(async (req, res) => {
  const resume = await TailoredResume.findOne({
    _id: req.params.id,
    owner: req.user._id,
  });

  if (!resume) throw ApiError.notFound("Tailored resume not found");
  if (resume.status === "approved") {
    throw ApiError.conflict(
      "Approved tailored resumes are locked. Regenerate a new revision instead of editing an approved version."
    );
  }

  const current = resume.content.toObject();
  const patch = req.body.content;

  resume.content = {
    ...current,
    ...patch,
    contact: { ...(current.contact || {}), ...(patch.contact || {}) },
  };

  const editedContent = resume.content.toObject();
  const nextDiff = buildTailoredDiff({
    content: editedContent,
    profile: req.user.profile || {},
  });
  const baseResume = await Resume.findById(resume.baseResume);
  nextDiff.sourceResume = buildSourceResumeDiff({
    resume: baseResume,
    content: editedContent,
  });
  resume.diff = nextDiff;

  const job = await Job.findById(resume.job);
  if (!job) throw ApiError.unprocessable("The linked job no longer exists");

  const files = await buildTailoredFiles({
    content: resume.content.toObject(),
    user: req.user,
    job,
    revision: resume.revision,
  });
  resume.files = files;
  resume.status = "draft";
  resume.approvedAt = undefined;
  await resume.save();

  await recordActivity({
    owner: req.user._id,
    type: "tailored_resume_generated",
    message: `Edited tailored resume revision ${resume.revision}`,
    job: resume.job,
  });

  res.status(200).json({
    success: true,
    data: { tailoredResume: serializeTailoredResume(resume) },
  });
});

export const approveTailoredResume = asyncHandler(async (req, res) => {
  const resume = await TailoredResume.findOne({
    _id: req.params.id,
    owner: req.user._id,
  });

  if (!resume) throw ApiError.notFound("Tailored resume not found");

  if (resume.status !== "approved") {
    resume.status = "approved";
    resume.approvedAt = new Date();
    await resume.save();

    await recordActivity({
      owner: req.user._id,
      type: "tailored_resume_approved",
      message: `Approved tailored resume revision ${resume.revision}`,
      job: resume.job,
    });
  }

  res.status(200).json({
    success: true,
    data: { tailoredResume: serializeTailoredResume(resume) },
  });
});

export const regenerateTailoredResume = asyncHandler(async (req, res) => {
  const existing = await TailoredResume.findOne({
    _id: req.params.id,
    owner: req.user._id,
  });

  if (!existing) throw ApiError.notFound("Tailored resume not found");

  const { job, resume } = await loadContext(req.user._id, existing.job);
  const revision = await nextRevision(req.user._id, job._id);

  const generated = await generateDocument({
    user: req.user,
    job,
    resume,
    revision,
  });

  const created = await TailoredResume.create({
    owner: req.user._id,
    job: job._id,
    baseResume: resume._id,
    revision,
    status: "draft",
    ...generated,
  });

  await recordActivity({
    owner: req.user._id,
    type: "tailored_resume_generated",
    message: `Regenerated tailored resume revision ${created.revision} for ${job.title}`,
    job: job._id,
  });

  res.status(201).json({
    success: true,
    data: { tailoredResume: serializeTailoredResume(created) },
  });
});

export const downloadTailoredResume = asyncHandler(async (req, res) => {
  const { format } = req.params;

  if (!["pdf", "docx"].includes(format)) {
    throw ApiError.badRequest("Format must be pdf or docx");
  }

  const resume = await TailoredResume.findOne({
    _id: req.params.id,
    owner: req.user._id,
  }).select("+files.data");

  if (!resume) throw ApiError.notFound("Tailored resume not found");

  const file = (resume.files || []).find((entry) => entry.format === format);
  if (!file) {
    throw ApiError.notFound(`No ${format.toUpperCase()} version is stored`);
  }

  res.setHeader("Content-Type", file.mimeType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${file.fileName.replace(/"/g, "")}"`
  );
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(file.data);
});
