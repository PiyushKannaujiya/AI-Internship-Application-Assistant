import { createHash } from "node:crypto";
import path from "node:path";
import { Resume } from "../models/Resume.js";
import { recordActivity } from "../services/activity.js";
import { serializeUser } from "../services/profile.js";
import { buildExtractionReview } from "../services/resumeExtraction.js";
import { parseResumeBuffer } from "../services/resumeParser.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { canonicalSkill } from "../utils/skills.js";

function serializeResume(resume, { includeText = false } = {}) {
  const data = resume.toJSON();
  if (includeText) data.text = resume.text;
  return data;
}

export const getMyResume = asyncHandler(async (req, res) => {
  const resume = await Resume.findOne({ owner: req.user._id }).select("+text");

  res.status(200).json({
    success: true,
    data: { resume: resume ? serializeResume(resume, { includeText: true }) : null },
  });
});

export const uploadResume = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw ApiError.badRequest("Attach a resume file in the 'resume' field");
  }

  const { buffer, mimetype, originalname, size } = req.file;

  const parsedResume = await parseResumeBuffer(buffer, mimetype);
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const existing = await Resume.findOne({ owner: req.user._id });

  const resume = await Resume.findOneAndUpdate(
    { owner: req.user._id },
    {
      $set: {
        originalName: path.basename(originalname).slice(0, 255),
        mimeType: mimetype,
        size,
        fileData: buffer,
        text: parsedResume.text,
        parsed: parsedResume.parsed,
        checksum,
        uploadedAt: new Date(),
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  await recordActivity({
    owner: req.user._id,
    type: "resume_uploaded",
    message: existing ? "Resume replaced" : "Resume uploaded",
  });

  res.status(existing ? 200 : 201).json({
    success: true,
    data: { resume: serializeResume(resume), replaced: Boolean(existing) },
  });
});

export const deleteMyResume = asyncHandler(async (req, res) => {
  const result = await Resume.deleteOne({ owner: req.user._id });

  if (result.deletedCount === 0) {
    throw ApiError.notFound("No resume is stored for this account");
  }

  await recordActivity({
    owner: req.user._id,
    type: "resume_deleted",
    message: "Resume deleted",
  });

  res.status(200).json({
    success: true,
    data: { message: "Resume deleted" },
  });
});

function profileObject(user) {
  return typeof user.profile?.toObject === "function"
    ? user.profile.toObject()
    : { ...(user.profile || {}) };
}

function uniqueSkillList(current = [], proposed = [], limit = 50) {
  const merged = [...current];
  const seen = new Set(merged.map((skill) => skill.toLowerCase()));

  for (const skill of proposed) {
    const value = canonicalSkill(skill);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    merged.push(value);
  }

  return merged.slice(0, limit);
}

export const getExtractionReview = asyncHandler(async (req, res) => {
  const resume = await Resume.findOne({ owner: req.user._id }).select("+text");

  if (!resume) {
    throw ApiError.notFound(
      "Upload a resume before reviewing extracted profile data"
    );
  }

  const review = buildExtractionReview({
    resume,
    profile: profileObject(req.user),
  });

  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).json({ success: true, data: { review } });
});

/**
 * Applies reviewed extraction data. Existing profile values are protected
 * unless the caller explicitly opts in with overwriteVerified: true, and every
 * skipped value is reported back so nothing is replaced silently.
 */
export const applyExtraction = asyncHandler(async (req, res) => {
  const resume = await Resume.findOne({ owner: req.user._id }).select("+text");

  if (!resume) {
    throw ApiError.notFound(
      "Upload a resume before applying extracted profile data"
    );
  }

  const currentProfile = profileObject(req.user);
  const review = buildExtractionReview({ resume, profile: currentProfile });
  const {
    fields = {},
    skills,
    projects,
    certifications,
    achievements,
    education,
    overwriteVerified,
  } = req.body;

  const nextProfile = { ...currentProfile };
  const appliedFields = [];
  const skipped = [];

  const proposedFields = {
    headline: fields.headline ?? review.proposals.headline,
    phone: fields.phone ?? review.proposals.contact.phone,
    linkedinUrl: fields.linkedinUrl ?? review.proposals.contact.linkedinUrl,
    githubUrl: fields.githubUrl ?? review.proposals.contact.githubUrl,
    portfolioUrl:
      fields.portfolioUrl ?? review.proposals.contact.portfolioUrl,
  };

  for (const [key, rawValue] of Object.entries(proposedFields)) {
    const proposed = String(rawValue || "").trim();
    if (!proposed) continue;

    const current = String(currentProfile[key] || "").trim();
    if (
      current &&
      current.toLowerCase() !== proposed.toLowerCase() &&
      !overwriteVerified
    ) {
      skipped.push({
        field: key,
        reason: "existing_value_protected",
        current,
        proposed,
      });
      continue;
    }

    nextProfile[key] = proposed;
    appliedFields.push(key);
  }

  const proposedSkills = skills ?? review.proposals.skills;
  const mergedSkills = uniqueSkillList(
    currentProfile.skills || [],
    proposedSkills || []
  );
  const skillAdditions = mergedSkills.filter(
    (skill) =>
      !(currentProfile.skills || []).some(
        (existing) => existing.toLowerCase() === skill.toLowerCase()
      )
  );
  nextProfile.skills = mergedSkills;

  function appendEntries({ current = [], proposals = [], limit, key, nameOf }) {
    const seen = new Set(
      current.map((entry) => String(nameOf(entry) || "").trim().toLowerCase())
    );
    const added = [];

    for (const proposal of proposals) {
      const name = String(nameOf(proposal) || "").trim();
      if (!name) continue;
      if (seen.has(name.toLowerCase())) {
        skipped.push({ field: key, reason: "duplicate", proposed: name });
        continue;
      }
      seen.add(name.toLowerCase());
      added.push(proposal);
    }

    return {
      value: [...current, ...added].slice(0, limit),
      added,
    };
  }

  const projectEntries = (projects ?? review.proposals.projects).map(
    (project) => ({
      ...project,
      technologies: uniqueSkillList([], project.technologies || [], 20),
      accomplishments: (project.accomplishments || [])
        .map((entry) =>
          typeof entry === "string" ? { text: entry, verified: false } : entry
        )
        .filter((entry) => entry.text?.trim())
        .map((entry) => ({
          text: entry.text.trim(),
          verified: Boolean(entry.verified),
        })),
    })
  );

  const projectResult = appendEntries({
    current: currentProfile.projects || [],
    proposals: projectEntries,
    limit: 20,
    key: "projects",
    nameOf: (entry) => entry.name,
  });
  nextProfile.projects = projectResult.value;

  const certificationResult = appendEntries({
    current: currentProfile.certifications || [],
    proposals: certifications ?? review.proposals.certifications,
    limit: 20,
    key: "certifications",
    nameOf: (entry) => entry.name,
  });
  nextProfile.certifications = certificationResult.value;

  const achievementEntries = (
    achievements ?? review.proposals.achievements.map((title) => ({ title }))
  ).map((entry) =>
    typeof entry === "string" ? { title: entry } : entry
  );

  const achievementResult = appendEntries({
    current: currentProfile.achievements || [],
    proposals: achievementEntries,
    limit: 20,
    key: "achievements",
    nameOf: (entry) => entry.title,
  });
  nextProfile.achievements = achievementResult.value;

  if (education?.length) {
    const educationResult = appendEntries({
      current: currentProfile.education || [],
      proposals: education,
      limit: 10,
      key: "education",
      nameOf: (entry) =>
        `${entry.institution || ""}|${entry.degree || ""}`.toLowerCase(),
    });
    nextProfile.education = educationResult.value;
  }

  req.user.profile = nextProfile;
  await req.user.save();

  await recordActivity({
    owner: req.user._id,
    type: "profile_updated",
    message: "Profile updated from a reviewed resume extraction",
  });

  const hasResume = true;
  const finalReview = buildExtractionReview({
    resume,
    profile: profileObject(req.user),
  });

  res.status(200).json({
    success: true,
    data: {
      user: serializeUser(req.user, hasResume),
      applied: {
        fields: appliedFields,
        skills: skillAdditions,
        projects: projectResult.added.map((entry) => entry.name),
        certifications: certificationResult.added.map((entry) => entry.name),
        achievements: achievementResult.added.map((entry) => entry.title),
        overwriteVerified: Boolean(overwriteVerified),
      },
      skipped,
      review: finalReview,
    },
  });
});

export const downloadMyResume = asyncHandler(async (req, res) => {
  const resume = await Resume.findOne({ owner: req.user._id }).select(
    "+fileData"
  );

  if (!resume) throw ApiError.notFound("No resume is stored for this account");

  const extension = resume.mimeType === "application/pdf" ? "pdf" : "docx";
  const safeFilename = `resume-${req.user._id}.${extension}`;

  res.setHeader("Content-Type", resume.mimeType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safeFilename}"`
  );
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(resume.fileData);
});
