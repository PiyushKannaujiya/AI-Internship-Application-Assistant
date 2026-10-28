import { APPLICATION_STATUSES, Application } from "../models/Application.js";
import { Activity } from "../models/Activity.js";
import { Job } from "../models/Job.js";
import { Resume } from "../models/Resume.js";
import { getAiStatus } from "../services/ai.js";
import { buildMatch } from "../services/matching.js";
import { profileCompleteness } from "../services/profile.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const getDashboard = asyncHandler(async (req, res) => {
  const owner = req.user._id;

  const [statusRows, resume, recentActivity, recentApplications, jobs] =
    await Promise.all([
      Application.aggregate([
        { $match: { owner } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Resume.findOne({ owner }),
      Activity.find({ owner })
        .sort({ createdAt: -1 })
        .limit(8)
        .populate("job", "title company"),
      Application.find({ owner })
        .sort({ updatedAt: -1 })
        .limit(5)
        .populate("job", "title company location applicationUrl"),
      Job.find({ owner }).sort({ createdAt: -1 }).limit(20),
    ]);

  const countByStatus = Object.fromEntries(
    APPLICATION_STATUSES.map((status) => [status, 0])
  );
  for (const row of statusRows) {
    if (row._id in countByStatus) countByStatus[row._id] = row.count;
  }

  const totalTracked = Object.values(countByStatus).reduce(
    (sum, value) => sum + value,
    0
  );

  const stats = {
    savedJobs: countByStatus.saved,
    applications: totalTracked - countByStatus.saved,
    active: countByStatus.planned + countByStatus.in_progress,
    submitted: countByStatus.submitted,
    interviews: countByStatus.interview,
    offers: countByStatus.offer,
    rejections: countByStatus.rejected,
    totalTracked,
  };

  const applicationsByJob = new Map();
  if (jobs.length > 0) {
    const applicationRows = await Application.find({
      owner,
      job: { $in: jobs.map((job) => job._id) },
    }).select("job status");

    for (const row of applicationRows) {
      applicationsByJob.set(row.job.toString(), row);
    }
  }

  const recommendedJobs = jobs
    .map((job) => ({
      job,
      match: buildMatch({ job, user: req.user, resume }),
    }))
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, 4)
    .map(({ job, match }) => {
      const application = applicationsByJob.get(job._id.toString());
      return {
        ...job.toJSON(),
        applicationId: application?.id || null,
        applicationStatus: application?.status || null,
        match,
      };
    });

  const profile = req.user.profile || {};
  const completion = profileCompleteness({
    ...(typeof profile.toObject === "function" ? profile.toObject() : profile),
    name: req.user.name,
  });

  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).json({
    success: true,
    data: {
      stats,
      statusBreakdown: APPLICATION_STATUSES.map((status) => ({
        status,
        count: countByStatus[status],
      })),
      recentActivity: recentActivity.map((entry) => entry.toJSON()),
      recentApplications: recentApplications.map((entry) => entry.toJSON()),
      recommendedJobs,
      profileCompleteness: completion,
      resume: resume
        ? {
            id: resume.id,
            originalName: resume.originalName,
            uploadedAt: resume.uploadedAt,
            skills: resume.parsed?.skills?.length || 0,
          }
        : null,
      ai: getAiStatus(),
      recommendationNote:
        jobs.length === 0
          ? "Add or import jobs to receive match-based recommendations."
          : "Recommendations are scored by the deterministic matching engine using your profile and resume.",
    },
  });
});
