import { env } from "./config/env.js";
import { connectDB, disconnectDB } from "./config/db.js";
import app from "./app.js";
import { logger } from "./utils/logger.js";

let server;
let shuttingDown = false;

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info("shutdown_started", { reason });

  const forceExit = setTimeout(() => {
    logger.error("shutdown_forced");
    process.exit(1);
  }, 10000);
  forceExit.unref();

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await disconnectDB();
  } catch (error) {
    logger.error("shutdown_failed", { message: error.message });
    exitCode = 1;
  }

  clearTimeout(forceExit);
  process.exit(exitCode);
}

async function startServer() {
  await connectDB();

  server = app.listen(env.PORT, "0.0.0.0", () => {
    logger.info("server_started", {
      port: env.PORT,
      environment: env.NODE_ENV,
      health: "/api/health",
    });
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      logger.error("port_in_use", { port: env.PORT });
    } else {
      logger.error("server_error", { message: error.message });
    }

    void shutdown("server_error", 1);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", {
    message: reason instanceof Error ? reason.message : String(reason),
  });
  void shutdown("unhandled_rejection", 1);
});

process.on("uncaughtException", (error) => {
  logger.error("uncaught_exception", { message: error.message });
  void shutdown("uncaught_exception", 1);
});

startServer().catch(async (error) => {
  logger.error("server_startup_failed", { message: error.message });
  await disconnectDB().catch(() => {});
  process.exit(1);
});
