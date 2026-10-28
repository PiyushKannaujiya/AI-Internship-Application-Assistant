import { Resume } from "../models/Resume.js";
import { User, hashPassword } from "../models/User.js";
import { recordActivity } from "../services/activity.js";
import { profileCompleteness } from "../services/profile.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { signAccessToken } from "../utils/token.js";

function publicUser(user, { hasResume = false } = {}) {
  const safe = user.toSafeJSON();
  const profile = safe.profile || {};
  return {
    id: safe.id,
    name: safe.name,
    email: safe.email,
    profile,
    createdAt: safe.createdAt,
    updatedAt: safe.updatedAt,
    profileCompleteness: profileCompleteness({
      ...profile,
      name: safe.name,
    }),
    hasResume,
  };
}

export const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  const existing = await User.exists({ email });
  if (existing) {
    throw ApiError.conflict("An account with this email already exists");
  }

  const passwordHash = await hashPassword(password);
  let user;

  try {
    user = await User.create({ name, email, passwordHash });
  } catch (error) {
    if (error?.code === 11000) {
      throw ApiError.conflict("An account with this email already exists");
    }
    throw error;
  }

  await recordActivity({
    owner: user._id,
    type: "account_created",
    message: "Account created",
  });

  res.status(201).json({
    success: true,
    data: {
      user: publicUser(user),
      token: signAccessToken(user),
    },
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select(
    "+passwordHash +tokenVersion"
  );

  // Use the same response for unknown email and wrong password to avoid
  // leaking which accounts exist.
  if (!user) {
    throw ApiError.unauthorized("Invalid email or password");
  }

  const valid = await user.comparePassword(password);
  if (!valid) {
    throw ApiError.unauthorized("Invalid email or password");
  }

  const hasResume = Boolean(await Resume.exists({ owner: user._id }));

  res.status(200).json({
    success: true,
    data: {
      user: publicUser(user, { hasResume }),
      token: signAccessToken(user),
    },
  });
});

export const me = asyncHandler(async (req, res) => {
  const hasResume = Boolean(await Resume.exists({ owner: req.user._id }));
  res.status(200).json({
    success: true,
    data: { user: publicUser(req.user, { hasResume }) },
  });
});

export const logout = asyncHandler(async (req, res) => {
  await User.updateOne(
    { _id: req.user._id },
    { $inc: { tokenVersion: 1 } }
  );

  res.status(200).json({
    success: true,
    data: { message: "Signed out. All issued sessions were revoked." },
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select(
    "+passwordHash +tokenVersion"
  );

  if (!user) throw ApiError.unauthorized("Your account no longer exists");

  const valid = await user.comparePassword(currentPassword);
  if (!valid) {
    throw ApiError.badRequest("Current password is incorrect");
  }

  user.passwordHash = await hashPassword(newPassword);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  res.status(200).json({
    success: true,
    data: {
      message: "Password updated. Other sessions have been revoked.",
      token: signAccessToken(user),
    },
  });
});
