import { Router } from "express";
import {
  changePassword,
  login,
  logout,
  me,
  register,
} from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
} from "../validators/schemas.js";

const router = Router();

router.post("/register", authLimiter, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.get("/me", protect, me);
router.post("/logout", protect, logout);
router.post(
  "/change-password",
  protect,
  authLimiter,
  validate(changePasswordSchema),
  changePassword
);

export default router;
