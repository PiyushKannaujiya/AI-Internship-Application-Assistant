import { Application } from "../models/Application.js";
import { AutofillRun } from "../models/AutofillRun.js";
import { TailoredResume } from "../models/TailoredResume.js";
import {
  adapterSummary,
  detectAdapter,
  getAdapter,
  listAdapters,
} from "../services/autofill/adapters.js";
import { buildAutofillPlan } from "../services/autofill/plan.js";
import {
  DEFAULT_REQUIREMENTS,
  evaluateReadiness,
  normalizeRequirements,
} from "../services/readiness.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

async function loadApplication(req) {
  const application = await Application.findOne({
    _id: req.params.id,
    owner: req.user._id,
  }).populate("job");

  if (!application) throw ApiError.notFound("Application not found");
  if (!application.job) throw ApiError.notFound("The linked job no longer exists");

  return application;
}

async function loadResumeRevisions(ownerId, jobId) {
  const [approvedResume, latestDraft] = await Promise.all([
    TailoredResume.findOne({
      owner: ownerId,
      job: jobId,
      status: "approved",
    }).sort({ revision: -1 }),
    TailoredResume.findOne({
      owner: ownerId,
      job: jobId,
      status: "draft",
    }).sort({ revision: -1 }),
  ]);

  return { approvedResume, latestDraft };
}

async function buildReadiness(req, application, requirements) {
  const { approvedResume, latestDraft } = await loadResumeRevisions(
    req.user._id,
    application.job._id
  );

  return evaluateReadiness({
    user: req.user,
    job: application.job,
    application,
    approvedResume,
    latestDraft,
    adapter: detectAdapter(application.job.applicationUrl),
    requirements: requirements || DEFAULT_REQUIREMENTS,
  });
}

export const getApplicationReadiness = asyncHandler(async (req, res) => {
  const application = await loadApplication(req);
  const readiness = await buildReadiness(req, application);

  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).json({
    success: true,
    data: { readiness },
  });
});

export const evaluateApplicationReadiness = asyncHandler(async (req, res) => {
  const application = await loadApplication(req);
  const requirements = normalizeRequirements(req.body?.requirements || {});
  const readiness = await buildReadiness(req, application, requirements);

  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).json({
    success: true,
    data: { readiness },
  });
});

export const getApplicationAutofillPlan = asyncHandler(async (req, res) => {
  const application = await loadApplication(req);
  const { approvedResume } = await loadResumeRevisions(
    req.user._id,
    application.job._id
  );
  const adapter = detectAdapter(application.job.applicationUrl);

  const plan = buildAutofillPlan({
    user: req.user,
    job: application.job,
    application,
    approvedResume,
    adapter,
  });

  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).json({
    success: true,
    data: { plan },
  });
});

export const createAutofillRun = asyncHandler(async (req, res) => {
  const application = await loadApplication(req);

  if (!getAdapter(req.body.adapter)) {
    throw ApiError.badRequest(
      "Report a known portal adapter so the run can be audited"
    );
  }

  const run = await AutofillRun.create({
    ...req.body,
    // Even if a client sends `submitted: false`, the server owns this value.
    submitted: false,
    owner: req.user._id,
    application: application._id,
  });

  res.setHeader("Cache-Control", "private, no-store");
  res.status(201).json({
    success: true,
    data: {
      run: run.toJSON(),
      message:
        "Autofill run recorded. No application was submitted; the final click is always yours.",
    },
  });
});

export const listAutofillRuns = asyncHandler(async (req, res) => {
  const application = await loadApplication(req);
  const { limit } = req.validatedQuery;

  const runs = await AutofillRun.find({
    owner: req.user._id,
    application: application._id,
  })
    .sort({ createdAt: -1 })
    .limit(limit);

  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).json({
    success: true,
    data: { runs: runs.map((run) => run.toJSON()) },
  });
});

export const listPortalAdapters = asyncHandler(async (_req, res) => {
  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).json({
    success: true,
    data: {
      adapters: listAdapters(),
      detection:
        "Adapters are matched by application hostname. Unmatched portals use the manual fallback.",
    },
  });
});

export const detectPortalAdapter = asyncHandler(async (req, res) => {
  const { url } = req.validatedQuery;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw ApiError.badRequest("Enter a valid application URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw ApiError.badRequest("Only http(s) application URLs are supported");
  }

  const adapter = detectAdapter(url);

  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).json({
    success: true,
    data: {
      adapter: adapterSummary(adapter),
      detected: adapter.detected,
    },
  });
});
