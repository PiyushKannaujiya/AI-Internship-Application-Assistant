import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { verifyAccessToken } from "../utils/token.js";

export const protect = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    throw ApiError.unauthorized("Missing bearer token");
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    throw ApiError.unauthorized("Missing bearer token");
  }

  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub).select("+tokenVersion");

  if (!user) {
    throw ApiError.unauthorized("Your account no longer exists");
  }

  if ((user.tokenVersion ?? 0) !== payload.tv) {
    throw ApiError.unauthorized("Your session has been revoked");
  }

  req.user = user;
  req.userId = user._id;
  next();
});
