import { Router } from "express";
import {
  createApplication,
  deleteApplication,
  listApplications,
  previewApplication,
  submitApplication,
  updateApplication,
} from "../controllers/applicationController.js";
import { protect } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  applicationCreateSchema,
  applicationListQuerySchema,
  applicationUpdateSchema,
  autofillRunListQuerySchema,
  autofillRunSchema,
  idParamsSchema,
  readinessEvaluateSchema,
  submitApplicationSchema,
} from "../validators/schemas.js";
import {
  createAutofillRun,
  evaluateApplicationReadiness,
  getApplicationAutofillPlan,
  getApplicationReadiness,
  listAutofillRuns,
} from "../controllers/autofillController.js";

const router = Router();

router.use(protect);

router.get("/", validate(applicationListQuerySchema, "query"), listApplications);
router.post("/", validate(applicationCreateSchema), createApplication);

router.get("/:id/preview", validate(idParamsSchema, "params"), previewApplication);
router.get(
  "/:id/readiness",
  validate(idParamsSchema, "params"),
  getApplicationReadiness
);
router.post(
  "/:id/readiness",
  validate(idParamsSchema, "params"),
  validate(readinessEvaluateSchema),
  evaluateApplicationReadiness
);
router.get(
  "/:id/autofill-plan",
  validate(idParamsSchema, "params"),
  getApplicationAutofillPlan
);
router.get(
  "/:id/autofill-runs",
  validate(idParamsSchema, "params"),
  validate(autofillRunListQuerySchema, "query"),
  listAutofillRuns
);
router.post(
  "/:id/autofill-runs",
  validate(idParamsSchema, "params"),
  validate(autofillRunSchema),
  createAutofillRun
);
router.post(
  "/:id/submit",
  validate(idParamsSchema, "params"),
  validate(submitApplicationSchema),
  submitApplication
);
router.patch(
  "/:id",
  validate(idParamsSchema, "params"),
  validate(applicationUpdateSchema),
  updateApplication
);
router.delete("/:id", validate(idParamsSchema, "params"), deleteApplication);

export default router;
