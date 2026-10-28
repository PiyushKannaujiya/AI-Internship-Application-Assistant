export class ApiError extends Error {
  constructor(statusCode, message, { code, details } = {}) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(message, details) {
    return new ApiError(400, message, { code: "BAD_REQUEST", details });
  }

  static unauthorized(message = "Authentication required") {
    return new ApiError(401, message, { code: "UNAUTHORIZED" });
  }

  static forbidden(message = "You do not have permission to do that") {
    return new ApiError(403, message, { code: "FORBIDDEN" });
  }

  static notFound(message = "Resource not found") {
    return new ApiError(404, message, { code: "NOT_FOUND" });
  }

  static conflict(message, details) {
    return new ApiError(409, message, { code: "CONFLICT", details });
  }

  static unprocessable(message, details) {
    return new ApiError(422, message, { code: "UNPROCESSABLE", details });
  }

  static tooManyRequests(message = "Too many requests") {
    return new ApiError(429, message, { code: "RATE_LIMITED" });
  }

  static serviceUnavailable(message, details) {
    return new ApiError(503, message, { code: "SERVICE_UNAVAILABLE", details });
  }
}
