import { Resume } from "../models/Resume.js";
import { recordActivity } from "../services/activity.js";
import { serializeUser } from "../services/profile.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Approval is a deliberate user action, so every approved answer carries the
// moment it was approved. Unapproved drafts never get an approvedAt stamp.
function stampAnswerApprovals(answers, previousAnswers = []) {
  return answers.map((entry) => {
    const previous = previousAnswers.find(
      (candidate) => candidate.question === entry.question
    );
    return {
      ...entry,
      approvedAt: entry.approved
        ? previous?.approved && previous?.approvedAt
          ? previous.approvedAt
          : new Date()
        : undefined,
    };
  });
}

export const getProfile = asyncHandler(async (req, res) => {
  const hasResume = Boolean(await Resume.exists({ owner: req.user._id }));
  res.status(200).json({
    success: true,
    data: { user: serializeUser(req.user, hasResume) },
  });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { name, profile } = req.body;
  const user = req.user;

  if (name) user.name = name;

  if (profile) {
    const current =
      typeof user.profile?.toObject === "function"
        ? user.profile.toObject()
        : { ...(user.profile || {}) };

    const nextProfile = {
      ...current,
      ...Object.fromEntries(
        Object.entries(profile).filter(
          ([key]) => key !== "jobPreferences" && key !== "workAuthorization"
        )
      ),
    };

    if (profile.jobPreferences) {
      nextProfile.jobPreferences = {
        ...(current.jobPreferences || {}),
        ...profile.jobPreferences,
      };
    }

    if (profile.workAuthorization) {
      nextProfile.workAuthorization = {
        ...(current.workAuthorization || {}),
        ...profile.workAuthorization,
      };
    }

    if (profile.answerBank) {
      nextProfile.answerBank = stampAnswerApprovals(
        profile.answerBank,
        current.answerBank || []
      );
    }

    user.profile = nextProfile;
  }

  await user.save();

  await recordActivity({
    owner: user._id,
    type: "profile_updated",
    message: "Profile updated",
  });

  const hasResume = Boolean(await Resume.exists({ owner: user._id }));

  res.status(200).json({
    success: true,
    data: { user: serializeUser(user, hasResume) },
  });
});
