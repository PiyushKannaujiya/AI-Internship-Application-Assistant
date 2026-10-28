import rateLimit from "express-rate-limit";

function createLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        code: "RATE_LIMITED",
        message,
      });
    },
  });
}

export const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  message: "Too many requests. Please try again later.",
});

export const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: "Too many authentication attempts. Please try again later.",
});

export const aiLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  message: "AI generation limit reached. Please try again later.",
});

export const urlImportLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: "Too many URL imports. Please wait before trying another page.",
});

export const uploadLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  message: "Too many resume uploads. Please try again later.",
});
