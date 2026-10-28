import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import { readFileSync } from "node:fs";
import { env } from "./config/env.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import resumeRoutes from "./routes/resumeRoutes.js";
import jobRoutes from "./routes/jobRoutes.js";
import applicationRoutes from "./routes/applicationRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import tailoredResumeRoutes from "./routes/tailoredResumeRoutes.js";
import autofillRoutes from "./routes/autofillRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { ApiError } from "./utils/ApiError.js";
import { logger } from "./utils/logger.js";

const app = express();

app.disable("x-powered-by");
if (env.IS_PRODUCTION) {
  app.set("trust proxy", 1);
}

app.use(requestLogger);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

function isAllowedOrigin(origin) {
  if (env.CORS_ORIGINS.includes(origin)) return true;

  // Convenience for local development when Vite selects a nearby port.
  if (!env.IS_PRODUCTION) {
    try {
      const url = new URL(origin);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      );
    } catch {
      return false;
    }
  }

  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(
        new ApiError(403, "This origin is not allowed to access the API")
      );
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "Content-Disposition"],
    credentials: false,
    maxAge: 86400,
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const DB_STATES = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "AI Internship Application Assistant API is running",
    status: "ok",
    database: DB_STATES[mongoose.connection.readyState] || "unknown",
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/health/ready", (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    success: ready,
    status: ready ? "ready" : "not_ready",
    database: DB_STATES[mongoose.connection.readyState] || "unknown",
    timestamp: new Date().toISOString(),
  });
});

// OpenAPI documentation (public, read-only).
try {
  const specPath = new URL("../openapi.yaml", import.meta.url);
  const openApiDocument = YAML.parse(readFileSync(specPath, "utf8"));

  app.get("/api/openapi.json", (_req, res) => {
    res.status(200).json(openApiDocument);
  });

  app.use(
    "/api/docs",
    helmet.contentSecurityPolicy({
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    }),
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: "AI Internship Assistant API",
    })
  );
} catch (error) {
  logger.warn("openapi_docs_unavailable", { message: error?.message });
}

app.use("/api", apiLimiter);

app.get("/api", (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      name: "AI Internship Application Assistant API",
      version: "1.0.0",
      docs: "/api/docs",
      health: "/api/health",
    },
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/resumes", resumeRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/tailored-resumes", tailoredResumeRoutes);
app.use("/api/autofill", autofillRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "AI Internship Application Assistant API",
    docs: "/api/docs",
    health: "/api/health",
  });
});

app.use(notFound);
app.use(errorHandler);

export default app;
