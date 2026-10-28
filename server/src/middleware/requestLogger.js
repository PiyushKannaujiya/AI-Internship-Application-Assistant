import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";

export function requestLogger(req, res, next) {
  const requestId = req.headers["x-request-id"] || randomUUID();
  const startedAt = process.hrtime.bigint();

  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const meta = {
      requestId,
      method: req.method,
      path: req.originalUrl?.split("?")[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs),
    };

    if (res.statusCode >= 500) {
      logger.error("request_failed", meta);
    } else if (res.statusCode >= 400) {
      logger.warn("request_rejected", meta);
    } else {
      logger.info("request_completed", meta);
    }
  });

  next();
}
