const REDACTED_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "authorization",
  "jwt",
  "secret",
  "apikey",
  "api_key",
  "cookie",
  "resume",
  "resumetext",
]);

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 3) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => sanitize(item, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value !== "object") return value;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      output[key] = "[redacted]";
    } else {
      output[key] = sanitize(entry, depth + 1);
    }
  }
  return output;
}

function write(level, message, meta) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? sanitize(meta) : {}),
  });

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
};
