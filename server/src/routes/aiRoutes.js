import { Router } from "express";
import {
  applicationAnswers,
  coverLetter,
  explainMatch,
  resumeSuggestions,
  status,
} from "../controllers/aiController.js";
import { protect } from "../middleware/auth.js";
import { aiLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import {
  aiAnswersSchema,
  aiJobRequestSchema,
} from "../validators/schemas.js";

const router = Router();

router.use(protect);
router.get("/status", status);
router.post("/explain-match", aiLimiter, validate(aiJobRequestSchema), explainMatch);
router.post("/cover-letter", aiLimiter, validate(aiJobRequestSchema), coverLetter);
router.post(
  "/resume-suggestions",
  aiLimiter,
  validate(aiJobRequestSchema),
  resumeSuggestions
);
router.post(
  "/application-answers",
  aiLimiter,
  validate(aiAnswersSchema),
  applicationAnswers
);

export default router;
