import { Router } from "express";
import {
  createJob,
  deleteJob,
  discover,
  getJob,
  importJob,
  importUrl,
  listJobs,
  matchJob,
  saveJob,
  unsaveJob,
  updateJob,
} from "../controllers/jobController.js";
import { protect } from "../middleware/auth.js";
import { urlImportLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import {
  discoverQuerySchema,
  idParamsSchema,
  importJobSchema,
  jobCreateSchema,
  jobListQuerySchema,
  jobUpdateSchema,
  urlImportSchema,
} from "../validators/schemas.js";

const router = Router();

router.use(protect);

router.get("/discover", validate(discoverQuerySchema, "query"), discover);
router.post("/import", validate(importJobSchema), importJob);
router.post(
  "/import-url",
  urlImportLimiter,
  validate(urlImportSchema),
  importUrl
);

router.get("/", validate(jobListQuerySchema, "query"), listJobs);
router.post("/", validate(jobCreateSchema), createJob);

router.get("/:id", validate(idParamsSchema, "params"), getJob);
router.patch(
  "/:id",
  validate(idParamsSchema, "params"),
  validate(jobUpdateSchema),
  updateJob
);
router.delete("/:id", validate(idParamsSchema, "params"), deleteJob);

router.post("/:id/save", validate(idParamsSchema, "params"), saveJob);
router.delete("/:id/save", validate(idParamsSchema, "params"), unsaveJob);
router.post("/:id/match", validate(idParamsSchema, "params"), matchJob);

export default router;
