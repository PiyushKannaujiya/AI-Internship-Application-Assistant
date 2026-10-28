import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { ApiError } from "./ApiError.js";

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, tv: user.tokenVersion ?? 0, type: "access" },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN, issuer: "ai-internship-assistant" }
  );
}

export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: "ai-internship-assistant",
    });

    if (payload.type !== "access" || typeof payload.sub !== "string") {
      throw new Error("Unexpected token payload");
    }

    return payload;
  } catch {
    throw ApiError.unauthorized("Your session is invalid or has expired");
  }
}
