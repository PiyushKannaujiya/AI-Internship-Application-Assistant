import { Router } from "express";
import {
  applyExtraction,
  deleteMyResume,
  downloadMyResume,
  getExtractionReview,
  getMyResume,
  uploadResume,
} from "../controllers/resumeController.js";
import { protect } from "../middleware/auth.js";
import { uploadLimiter } from "../middleware/rateLimit.js";
import { resumeUpload } from "../middleware/upload.js";
import { validate } from "../middleware/validate.js";
import { resumeExtractionApplySchema } from "../validators/schemas.js";

const router = Router();

router.use(protect);
router.get("/me", getMyResume);
router.get("/me/file", downloadMyResume);
router.get("/me/extraction", getExtractionReview);
router.post(
  "/me/extraction/apply",
  validate(resumeExtractionApplySchema),
  applyExtraction
);
router.post("/", uploadLimiter, resumeUpload, uploadResume);
router.delete("/me", deleteMyResume);

export default router;
