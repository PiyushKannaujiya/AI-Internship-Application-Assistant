import mongoose from "mongoose";

export const JOB_TYPES = [
  "internship",
  "full-time",
  "part-time",
  "contract",
  "temporary",
  "other",
];

export const JOB_SOURCES = [
  "manual",
  "remotive",
  "url",
  "jobicy",
  "arbeitnow",
  "greenhouse",
  "lever",
  "ashby",
  "remoteok",
  "adzuna",
];

const jobSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 250 },
    company: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 30000 },
    skills: {
      type: [String],
      default: [],
      validate: {
        validator: (value) => value.length <= 60,
        message: "At most 60 skills are allowed",
      },
    },
    location: { type: String, trim: true, maxlength: 200, default: "Not specified" },
    jobType: { type: String, enum: JOB_TYPES, default: "other", index: true },
    remote: { type: Boolean, default: false, index: true },
    source: { type: String, enum: JOB_SOURCES, default: "manual" },
    externalId: { type: String, trim: true, maxlength: 120 },
    applicationUrl: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
      validate: {
        validator(value) {
          try {
            const url = new URL(value);
            return ["http:", "https:"].includes(url.protocol);
          } catch {
            return false;
          }
        },
        message: "Application URL must be a valid http(s) URL",
      },
    },
    dedupeKey: { type: String, required: true, maxlength: 500 },
    postedAt: { type: Date },
    category: { type: String, trim: true, maxlength: 120, default: "" },
    salary: { type: String, trim: true, maxlength: 200, default: "" },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.__v;
        delete ret.dedupeKey;
        ret.id = ret._id.toString();
        delete ret._id;
        return ret;
      },
    },
  }
);

jobSchema.index({ owner: 1, dedupeKey: 1 }, { unique: true });
jobSchema.index({ owner: 1, createdAt: -1 });
jobSchema.index({ owner: 1, title: "text", company: "text", description: "text" });

export const Job = mongoose.model("Job", jobSchema);

export function buildDedupeKey({ company, title, applicationUrl }) {
  try {
    const url = new URL(applicationUrl);
    url.hash = "";
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "source",
    ];
    for (const param of trackingParams) url.searchParams.delete(param);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.toLowerCase()}${pathname}${url.search}`.toLowerCase();
  } catch {
    return `${company}:${title}`.toLowerCase().replace(/\s+/g, " ").trim();
  }
}
