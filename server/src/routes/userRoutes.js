import { Router } from "express";
import { getProfile, updateProfile } from "../controllers/userController.js";
import { protect } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { profileUpdateSchema } from "../validators/schemas.js";

const router = Router();

router.use(protect);
router.get("/me", getProfile);
router.patch("/me", validate(profileUpdateSchema), updateProfile);

export default router;
