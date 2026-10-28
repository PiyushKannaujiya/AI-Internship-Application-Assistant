import { Router } from "express";
import {
  detectPortalAdapter,
  listPortalAdapters,
} from "../controllers/autofillController.js";
import { protect } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { adapterDetectQuerySchema } from "../validators/schemas.js";

const router = Router();

router.use(protect);

router.get("/adapters", listPortalAdapters);
router.get(
  "/adapters/detect",
  validate(adapterDetectQuerySchema, "query"),
  detectPortalAdapter
);

export default router;
