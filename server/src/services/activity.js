import { Activity } from "../models/Activity.js";
import { logger } from "../utils/logger.js";

export async function recordActivity({ owner, type, message, job }) {
  try {
    await Activity.create({ owner, type, message, job });
  } catch (error) {
    logger.warn("activity_write_failed", { message: error?.message });
  }
}
