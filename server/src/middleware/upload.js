import multer from "multer";
import path from "node:path";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx"]);
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
]);

const storage = multer.memoryStorage();

export const resumeUpload = multer({
  storage,
  limits: {
    files: 1,
    fileSize: env.UPLOAD_MAX_BYTES,
    fields: 5,
  },
  fileFilter(_req, file, callback) {
    const extension = path.extname(file.originalname || "").toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return callback(
        ApiError.badRequest("Only PDF and DOCX resume files are supported")
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return callback(
        ApiError.badRequest("Unsupported resume file content type")
      );
    }

    callback(null, true);
  },
}).single("resume");
