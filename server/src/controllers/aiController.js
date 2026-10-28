import { Application } from "../models/Application.js";
import { Job } from "../models/Job.js";
import { Resume } from "../models/Resume.js";
import { recordActivity } from "../services/activity.js";
import {
  assertAiInputs,
  generateApplicationAnswers,
  generateCoverLetter,
  generateResumeSuggestions,
  getAiStatus,
} from "../services/ai.js";
import { buildMatch } from "../services/matching.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

async function loadContext(userId) {
  const resume = await Resume.findOne({ owner: userId }).select("+text");
  return resume;
}

export const status = asyncHandler(async (_req, res) => {
  res.status(200).json({ success: true, data: getAiStatus() });
});

export const coverLetter = asyncHandler(async (req, res) => {
  const { jobId, tone } = req.body;

  const [job, resume] = await Promise.all([
    Job.findOne({ _id: jobId, owner: req.user._id }),
    loadContext(req.user._id),
  ]);

  assertAiInputs(job, resume);

  const match = buildMatch({ job, user: req.user, resume });
  const result = await generateCoverLetter({
    user: req.user,
    resume,
    job,
    match,
    tone,
  });

  // Persist the draft where the workflow can find it for preview/copy.
  let application = await Application.findOne({
    owner: req.user._id,
    job: job._id,
  });

  if (application) {
    application.coverLetter = {
      subject: result.subject,
      body: result.body,
      provider: result.provider,
      generatedAt: new Date(),
    };
    await application.save();
  }

  await recordActivity({
    owner: req.user._id,
    type: "cover_letter_generated",
    message: `Generated a cover letter draft for ${job.title}`,
    job: job._id,
  });

  res.status(200).json({
    success: true,
    data: {
      coverLetter: result,
      match,
      ai: getAiStatus(),
      applicationId: application?.id || null,
    },
  });
});

export const resumeSuggestions = asyncHandler(async (req, res) => {
  const { jobId } = req.body;

  const [job, resume] = await Promise.all([
    Job.findOne({ _id: jobId, owner: req.user._id }),
    loadContext(req.user._id),
  ]);

  assertAiInputs(job, resume);

  const match = buildMatch({ job, user: req.user, resume });
  const result = await generateResumeSuggestions({
    user: req.user,
    resume,
    job,
    match,
  });

  res.status(200).json({
    success: true,
    data: { ...result, match, ai: getAiStatus() },
  });
});

export const applicationAnswers = asyncHandler(async (req, res) => {
  const { jobId, questions } = req.body;

  const [job, resume] = await Promise.all([
    Job.findOne({ _id: jobId, owner: req.user._id }),
    loadContext(req.user._id),
  ]);

  assertAiInputs(job, resume);

  const match = buildMatch({ job, user: req.user, resume });
  const result = await generateApplicationAnswers({
    user: req.user,
    resume,
    job,
    match,
    questions,
  });

  res.status(200).json({
    success: true,
    data: { ...result, ai: getAiStatus() },
  });
});

export const explainMatch = asyncHandler(async (req, res) => {
  const { jobId } = req.body;
  const job = await Job.findOne({ _id: jobId, owner: req.user._id });
  if (!job) throw ApiError.notFound("Job not found");

  const resume = await loadContext(req.user._id);
  const match = buildMatch({ job, user: req.user, resume });

  res.status(200).json({
    success: true,
    data: { match, resumeUsed: Boolean(resume) },
  });
});
