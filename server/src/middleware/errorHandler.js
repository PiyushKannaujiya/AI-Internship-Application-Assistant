import mongoose from "mongoose";
import multer from "multer";
import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

export function errorHandler(err, req, res, _next) {
  if (res.headersSent) {
    return;
  }

  let statusCode = 500;
  let message = "Internal server error";
  let code = "INTERNAL_ERROR";
  let details;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    code = err.code || code;
    details = err.details;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    message = "Validation failed";
    code = "VALIDATION_ERROR";
    details = err.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
  } else if (err instanceof multer.MulterError) {
    statusCode = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Resume file is too large"
        : `Upload failed: ${err.message}`;
    code = "UPLOAD_ERROR";
  } else if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 400;
    message = "Validation failed";
    code = "VALIDATION_ERROR";
    details = Object.values(err.errors).map((entry) => ({
      field: entry.path,
      message: entry.message,
    }));
  } else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = "Invalid identifier";
    code = "INVALID_ID";
  } else if (err?.code === 11000) {
    statusCode = 409;
    message = "This record already exists";
    code = "DUPLICATE";
  } else if (err?.type === "entity.too.large") {
    statusCode = 413;
    message = "Request body is too large";
    code = "PAYLOAD_TOO_LARGE";
  } else if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    statusCode = 400;
    message = "Malformed JSON body";
    code = "MALFORMED_JSON";
  }

  if (statusCode >= 500) {
    logger.error("unhandled_error", {
      requestId: req.requestId,
      name: err?.name,
      message: err?.message,
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined,
    });
  }

  res.status(statusCode).json({
    success: false,
    code,
    message,
    ...(details ? { errors: details } : {}),
    ...(req.requestId ? { requestId: req.requestId } : {}),
  });
}
