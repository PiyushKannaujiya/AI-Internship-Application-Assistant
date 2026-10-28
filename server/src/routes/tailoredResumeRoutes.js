import { Router } from "express";
import {
  approveTailoredResume,
  createTailoredResume,
  downloadTailoredResume,
  getTailoredResume,
  listTailoredResumes,
  regenerateTailoredResume,
  updateTailoredResume,
} from "../controllers/tailoredResumeController.js";
import { protect } from "../middleware/auth.js";
import { aiLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import {
  idParamsSchema,
  tailoredDownloadParamsSchema,
  tailoredResumeApproveSchema,
  tailoredResumeCreateSchema,
  tailoredResumeListQuerySchema,
  tailoredResumeUpdateSchema,
} from "../validators/schemas.js";

const router = Router();

router.use(protect);

router.get("/", validate(tailoredResumeListQuerySchema, "query"), listTailoredResumes);
router.post("/", aiLimiter, validate(tailoredResumeCreateSchema), createTailoredResume);

router.get(
  "/:id/download/:format",
  validate(tailoredDownloadParamsSchema, "params"),
  downloadTailoredResume
);
router.get("/:id", validate(idParamsSchema, "params"), getTailoredResume);
router.patch(
  "/:id",
  validate(idParamsSchema, "params"),
  validate(tailoredResumeUpdateSchema),
  updateTailoredResume
);
router.post(
  "/:id/approve",
  validate(idParamsSchema, "params"),
  validate(tailoredResumeApproveSchema),
  approveTailoredResume
);
router.post(
  "/:id/regenerate",
  validate(idParamsSchema, "params"),
  regenerateTailoredResume
);

export default router;
