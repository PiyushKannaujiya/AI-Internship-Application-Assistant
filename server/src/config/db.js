import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

const RETRY_DELAYS_MS = [0, 1500, 4000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function connectDB() {
  if (!env.MONGO_URI) {
    throw new Error(
      "MONGO_URI is missing. Add it to server/.env locally or to the hosting provider's environment variables."
    );
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  let lastError;

  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await sleep(delay);

    try {
      await mongoose.connect(env.MONGO_URI, {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 10,
        autoIndex: true,
      });

      logger.info("mongodb_connected", {
        database: mongoose.connection.name,
      });
      return mongoose.connection;
    } catch (error) {
      lastError = error;
      logger.warn("mongodb_connection_attempt_failed", {
        message: error.message,
      });
    }
  }

  throw new Error(
    `MongoDB connection failed: ${lastError?.message || "unknown error"}`
  );
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info("mongodb_disconnected");
  }
}
