import "dotenv/config";
import { z } from "zod";

// Treat empty strings in .env files as "not set" so defaults apply.
const optionalString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().optional()
);

const optionalNumber = (schema) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema
  );

const optionalBoolean = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === true || value === "true" || value === "1") return true;
    if (value === false || value === "false" || value === "0") return false;
    return value;
  },
  z.boolean().default(false)
);

const envSchema = z
  .object({
    PORT: optionalNumber(
      // Some shells export PORT=0; treat it as unset so local defaults apply.
      z.preprocess(
        (value) =>
          value === undefined || value === null || Number(value) === 0
            ? undefined
            : value,
        z.coerce.number().int().min(1).max(65535).default(5000)
      )
    ),

    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),

    CLIENT_URL: optionalNumber(z.string().default("http://localhost:5173")),

    MONGO_URI: optionalString,

    JWT_SECRET: optionalString,

    JWT_EXPIRES_IN: optionalNumber(z.string().default("7d")),

    BCRYPT_ROUNDS: optionalNumber(
      z.coerce.number().int().min(10).max(15).default(12)
    ),

    UPLOAD_MAX_BYTES: optionalNumber(
      z.coerce
        .number()
        .int()
        .min(1024)
        .max(10 * 1024 * 1024)
        .default(5 * 1024 * 1024)
    ),

    AI_PROVIDER: z.enum(["none", "openai"]).default("none"),

    AI_API_KEY: optionalString,

    AI_BASE_URL: optionalNumber(
      z.string().url().default("https://api.openai.com/v1")
    ),

    AI_MODEL: optionalNumber(z.string().default("gpt-4o-mini")),

    AI_TIMEOUT_MS: optionalNumber(
      z.coerce.number().int().min(1000).max(120000).default(30000)
    ),

    JOBS_API_URL: optionalNumber(
      z.string().url().default("https://remotive.com/api/remote-jobs")
    ),

    // Comma separated source names. "remotive" keeps the historical default.
    JOB_DISCOVERY_SOURCES: optionalString,

    JOB_SOURCE_TIMEOUT_MS: optionalNumber(
      z.coerce.number().int().min(1000).max(30000).default(8000)
    ),

    // Public board names for sources that are addressed per company.
    GREENHOUSE_BOARDS: optionalString,

    LEVER_SITES: optionalString,

    ASHBY_ORGS: optionalString,

    // Workable accounts to read via the public jobs widget (verified boards by
    // default; override with a comma separated list).
    WORKABLE_ACCOUNTS: optionalString,

    // SmartRecruiters company ids to read via their public posting API. The
    // country below defaults to India so large boards (e.g. LinkedIn's own)
    // surface their Indian postings instead of the worldwide page-one mix.
    SMARTRECRUITERS_BOARDS: optionalString,

    // Two-letter country filter for the SmartRecruiters posting API. India by
    // default; leave out other values unless deliberately widening the index.
    SMARTRECRUITERS_COUNTRY: optionalNumber(
      z.string().regex(/^[a-z]{2}$/i, "must be a 2-letter country code").default("in")
    ),

    // Adzuna official API credentials (free account at api.adzuna.com). The
    // adzuna source is skipped with a not_configured note until both are set.
    ADZUNA_APP_ID: optionalString,

    ADZUNA_APP_KEY: optionalString,

    // ISO country code for the Adzuna index; India by default.
    ADZUNA_COUNTRY: optionalString,

    URL_IMPORT_TIMEOUT_MS: optionalNumber(
      z.coerce.number().int().min(1000).max(30000).default(10000)
    ),

    URL_IMPORT_MAX_BYTES: optionalNumber(
      z.coerce
        .number()
        .int()
        .min(1024)
        .max(5 * 1024 * 1024)
        .default(2 * 1024 * 1024)
    ),

    URL_IMPORT_MAX_REDIRECTS: optionalNumber(
      z.coerce.number().int().min(0).max(5).default(3)
    ),

    // Insecure transports and private destinations are refused by default.
    // They exist only so tests can point the importer at a local fixture.
    URL_IMPORT_ALLOW_HTTP: optionalBoolean,

    URL_IMPORT_ALLOW_PRIVATE_HOSTS: optionalBoolean,
  })
  .superRefine((value, ctx) => {
    const isProduction = value.NODE_ENV === "production";

    if (isProduction && !value.MONGO_URI) {
      ctx.addIssue({
        code: "custom",
        path: ["MONGO_URI"],
        message: "MONGO_URI is required in production",
      });
    }

    if (isProduction && !value.JWT_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_SECRET"],
        message: "JWT_SECRET is required in production",
      });
    }

    if (isProduction && value.JWT_SECRET && value.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_SECRET"],
        message: "JWT_SECRET must be at least 32 characters in production",
      });
    }

    if (isProduction && value.URL_IMPORT_ALLOW_HTTP) {
      ctx.addIssue({
        code: "custom",
        path: ["URL_IMPORT_ALLOW_HTTP"],
        message: "Plain HTTP URL imports are not allowed in production",
      });
    }

    if (isProduction && value.URL_IMPORT_ALLOW_PRIVATE_HOSTS) {
      ctx.addIssue({
        code: "custom",
        path: ["URL_IMPORT_ALLOW_PRIVATE_HOSTS"],
        message:
          "Private-host URL imports break SSRF protection and are not allowed in production",
      });
    }

    if (value.AI_PROVIDER === "openai" && !value.AI_API_KEY && isProduction) {
      ctx.addIssue({
        code: "custom",
        path: ["AI_API_KEY"],
        message: "AI_API_KEY is required when AI_PROVIDER=openai",
      });
    }

    if (
      value.ADZUNA_COUNTRY &&
      !/^[a-z]{2}$/i.test(String(value.ADZUNA_COUNTRY).trim())
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["ADZUNA_COUNTRY"],
        message: "ADZUNA_COUNTRY must be a 2-letter country code, e.g. in",
      });
    }

    const origins = value.CLIENT_URL.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);

    for (const origin of origins) {
      try {
        const url = new URL(origin);
        if (!["http:", "https:"].includes(url.protocol)) {
          throw new Error("unsupported protocol");
        }
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["CLIENT_URL"],
          message: `Invalid CORS origin: ${origin}`,
        });
      }
    }
  });

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment configuration:");
  for (const issue of result.error.issues) {
    console.error(`- ${issue.path.join(".")}: ${issue.message}`);
  }
  throw new Error("Server startup aborted due to invalid environment variables.");
}

const parsed = result.data;

const DEV_JWT_SECRET =
  "local-development-only-secret-change-before-deploying-please";

if (!parsed.JWT_SECRET && parsed.NODE_ENV !== "production") {
  console.warn(
    "JWT_SECRET is not set; using an insecure development-only default."
  );
}

export const env = Object.freeze({
  ...parsed,
  JOB_DISCOVERY_SOURCES: parsed.JOB_DISCOVERY_SOURCES || "remotive",
  JWT_SECRET: parsed.JWT_SECRET || DEV_JWT_SECRET,
  CORS_ORIGINS: parsed.CLIENT_URL.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  IS_PRODUCTION: parsed.NODE_ENV === "production",
});
