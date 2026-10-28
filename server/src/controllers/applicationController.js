import { Application } from "../models/Application.js";
import { Job } from "../models/Job.js";
import { TailoredResume } from "../models/TailoredResume.js";
import { recordActivity } from "../services/activity.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function paginationMeta({ page, limit, total }) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return { page, limit, total, totalPages, hasNextPage: page < totalPages };
}

export const listApplications = asyncHandler(async (req, res) => {
  const { status, q, page, limit } = req.validatedQuery;
  const filter = { owner: req.user._id };

  if (status) filter.status = status;

  if (q) {
    const pattern = new RegExp(escapeRegex(q.slice(0, 100)), "i");
    const jobs = await Job.find({
      owner: req.user._id,
      $or: [
        { title: pattern },
        { company: pattern },
        { location: pattern },
        { skills: pattern },
      ],
    }).select("_id");

    if (jobs.length === 0) {
      return res.status(200).json({
        success: true,
        data: { applications: [] },
        meta: paginationMeta({ page, limit, total: 0 }),
      });
    }
    filter.job = { $in: jobs.map((job) => job._id) };
  }

  const [applications, total] = await Promise.all([
    Application.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("job", "title company location jobType remote applicationUrl postedAt skills"),
    Application.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { applications: applications.map((app) => app.toJSON()) },
    meta: paginationMeta({ page, limit, total }),
  });
});

export const createApplication = asyncHandler(async (req, res) => {
  const { jobId, status } = req.body;

  const job = await Job.findOne({ _id: jobId, owner: req.user._id });
  if (!job) throw ApiError.notFound("Job not found");

  const existing = await Application.findOne({
    owner: req.user._id,
    job: job._id,
  });

  if (existing) {
    throw ApiError.conflict("This job is already being tracked", {
      applicationId: existing.id,
    });
  }

  const application = await Application.create({
    owner: req.user._id,
    job: job._id,
    status,
    statusHistory: [{ status, at: new Date() }],
  });

  res.status(201).json({
    success: true,
    data: {
      application: application.toJSON(),
      job: job.toJSON(),
    },
  });
});

export const updateApplication = asyncHandler(async (req, res) => {
  const { status, notes, coverLetter } = req.body;

  if (status === "submitted") {
    throw ApiError.badRequest(
      "Use the explicit submission confirmation endpoint to mark an application as submitted"
    );
  }

  const application = await Application.findOne({
    _id: req.params.id,
    owner: req.user._id,
  }).populate("job", "title company");

  if (!application) throw ApiError.notFound("Application not found");

  if (notes !== undefined) application.notes = notes;

  if (coverLetter !== undefined) {
    application.coverLetter = {
      subject: coverLetter.subject,
      body: coverLetter.body,
      provider: "manual_edit",
      generatedAt: application.coverLetter?.generatedAt || new Date(),
    };
  }

  if (status && status !== application.status) {
    application.status = status;
    application.statusHistory.push({ status, at: new Date() });

    await recordActivity({
      owner: req.user._id,
      type: "status_changed",
      message: `${application.job?.title || "Application"} moved to ${status}`,
      job: application.job?._id,
    });
  }

  await application.save();

  res.status(200).json({
    success: true,
    data: { application: application.toJSON() },
  });
});

export const submitApplication = asyncHandler(async (req, res) => {
  const { method } = req.body;

  const application = await Application.findOne({
    _id: req.params.id,
    owner: req.user._id,
  }).populate("job", "title company");

  if (!application) throw ApiError.notFound("Application not found");

  if (application.status === "submitted" && application.submittedAt) {
    return res.status(200).json({
      success: true,
      data: {
        application: application.toJSON(),
        message: "Application was already recorded as submitted",
      },
    });
  }

  application.status = "submitted";
  application.submittedAt = new Date();
  application.submissionMethod = method;
  application.lastError = "";
  application.statusHistory.push({ status: "submitted", at: new Date() });
  await application.save();

  await recordActivity({
    owner: req.user._id,
    type: "submitted",
    message: `Recorded submission for ${application.job?.title || "an application"}`,
    job: application.job?._id,
  });

  res.status(200).json({
    success: true,
    data: {
      application: application.toJSON(),
      message:
        "Submission recorded. This app never submits applications on your behalf.",
    },
  });
});

export const deleteApplication = asyncHandler(async (req, res) => {
  const application = await Application.findOneAndDelete({
    _id: req.params.id,
    owner: req.user._id,
  });

  if (!application) throw ApiError.notFound("Application not found");

  res.status(200).json({
    success: true,
    data: { message: "Application tracking record deleted" },
  });
});

export const previewApplication = asyncHandler(async (req, res) => {
  const application = await Application.findOne({
    _id: req.params.id,
    owner: req.user._id,
  }).populate("job");

  if (!application) throw ApiError.notFound("Application not found");
  if (!application.job) {
    throw ApiError.notFound("The linked job no longer exists");
  }

  const [approvedTailored, latestDraft] = await Promise.all([
    TailoredResume.findOne({
      owner: req.user._id,
      job: application.job._id,
      status: "approved",
    }).sort({ revision: -1 }),
    TailoredResume.findOne({
      owner: req.user._id,
      job: application.job._id,
      status: "draft",
    }).sort({ revision: -1 }),
  ]);

  const profile = req.user.profile || {};
  const workAuthorizationStatus = profile.workAuthorization?.status || "";
  const workAuthorizationLabel =
    workAuthorizationStatus && workAuthorizationStatus !== "prefer_not_to_say"
      ? workAuthorizationStatus.replace(/_/g, " ")
      : "";
  const approvedAnswers = (profile.answerBank || [])
    .filter((entry) => entry.approved && entry.question && entry.answer)
    .map((entry) => ({
      question: entry.question,
      answer: entry.answer,
      approvedAt: entry.approvedAt || null,
    }));
  const fields = [
    { key: "fullName", label: "Full name", value: req.user.name },
    { key: "email", label: "Email", value: req.user.email },
    { key: "phone", label: "Phone", value: profile.phone || "" },
    { key: "location", label: "Location", value: profile.location || "" },
    { key: "linkedin", label: "LinkedIn", value: profile.linkedinUrl || "" },
    { key: "github", label: "GitHub", value: profile.githubUrl || "" },
    { key: "portfolio", label: "Portfolio", value: profile.portfolioUrl || "" },
    { key: "headline", label: "Headline", value: profile.headline || "" },
    {
      key: "skills",
      label: "Skills",
      value: (profile.skills || []).join(", "),
    },
    { key: "summary", label: "Summary", value: profile.summary || "" },
    {
      key: "workAuthorization",
      label: "Work authorization",
      value: workAuthorizationLabel,
    },
  ].filter((field) => field.value);

  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).json({
    success: true,
    data: {
      application: application.toJSON(),
      job: {
        id: application.job.id,
        title: application.job.title,
        company: application.job.company,
        applicationUrl: application.job.applicationUrl,
        location: application.job.location,
      },
      tailoredResume: approvedTailored
        ? {
            id: approvedTailored.id,
            revision: approvedTailored.revision,
            approvedAt: approvedTailored.approvedAt,
            provider: approvedTailored.provider,
            downloads: {
              pdf: `/api/tailored-resumes/${approvedTailored.id}/download/pdf`,
              docx: `/api/tailored-resumes/${approvedTailored.id}/download/docx`,
            },
          }
        : null,
      tailoredResumeWorkflow: {
        approvedRequired: true,
        draftAvailable: Boolean(latestDraft),
        latestDraftRevision: latestDraft?.revision || null,
        notice: approvedTailored
          ? `Approved tailored resume revision ${approvedTailored.revision} is available for this application.`
          : latestDraft
            ? "A tailored resume revision is still a draft. Approve it before using it for an application."
            : "No tailored resume has been generated for this job.",
      },
      prefill: {
        fields,
        coverLetter: application.coverLetter?.body || "",
        // Only answers the user explicitly approved are offered for reuse.
        answers: approvedAnswers,
        answerBankNotice: approvedAnswers.length
          ? "These answers were approved by you for reuse. Re-read every answer before pasting it."
          : "No approved saved answers yet. Approve answers on your profile to reuse them.",
      },
      workflow: {
        automatedSubmission: false,
        requiresExplicitApproval: true,
        instructions: [
          "Review every prefilled value for accuracy.",
          "Open the employer's application page in your browser.",
          "Paste or type the values and generated content yourself.",
          "Submit the form yourself when you are satisfied.",
          "Return here and explicitly confirm the submission to record it.",
        ],
        limitations: [
          "This app does not bypass CAPTCHAs, MFA, anti-bot controls, or site terms.",
          "No background browser automation runs on your behalf.",
          "Some sites may block automated form filling; use the direct link and paste values manually.",
        ],
      },
    },
  });
});
