import mongoose from "mongoose";

/**
 * A report from the local Playwright helper. These rows are audit records of a
 * human-supervised fill, never a submission: `submitted` is immutable false.
 */
const filledFieldSchema = new mongoose.Schema(
  {
    canonical: { type: String, trim: true, maxlength: 80, default: "" },
    label: { type: String, trim: true, maxlength: 160, default: "" },
    selector: { type: String, trim: true, maxlength: 300, default: "" },
  },
  { _id: false }
);

const missingFieldSchema = new mongoose.Schema(
  {
    canonical: { type: String, trim: true, maxlength: 80, default: "" },
    label: { type: String, trim: true, maxlength: 160, default: "" },
    reason: { type: String, trim: true, maxlength: 200, default: "" },
  },
  { _id: false }
);

const validationErrorSchema = new mongoose.Schema(
  {
    field: { type: String, trim: true, maxlength: 160, default: "" },
    message: { type: String, trim: true, maxlength: 300, default: "" },
  },
  { _id: false }
);

const autofillRunSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    application: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    adapter: { type: String, trim: true, maxlength: 60, required: true },
    pageUrl: { type: String, trim: true, maxlength: 2000, default: "" },
    status: {
      type: String,
      enum: ["prepared", "needs_review", "failed"],
      default: "prepared",
      index: true,
    },
    filledFields: { type: [filledFieldSchema], default: [] },
    missingFields: { type: [missingFieldSchema], default: [] },
    validationErrors: { type: [validationErrorSchema], default: [] },
    unsupportedControls: { type: [String], default: [] },
    blockedBy: {
      type: [String],
      enum: ["captcha", "otp", "mfa", "login", "terms", "unsupported_form"],
      default: [],
    },
    resumeUploaded: {
      format: { type: String, enum: ["pdf", "docx"], default: "pdf" },
      fileName: { type: String, trim: true, maxlength: 255, default: "" },
    },
    coverLetterFilled: { type: Boolean, default: false },
    answersFilled: { type: [String], default: [] },
    botProtection: {
      detected: { type: Boolean, default: false },
      visibleChallenge: { type: Boolean, default: false },
      kinds: { type: [String], default: [] },
    },
    submitted: { type: Boolean, default: false, immutable: true },
    notes: { type: String, trim: true, maxlength: 500, default: "" },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.__v;
        ret.id = ret._id.toString();
        delete ret._id;
        return ret;
      },
    },
  }
);

autofillRunSchema.index({ owner: 1, application: 1, createdAt: -1 });

export const AutofillRun = mongoose.model("AutofillRun", autofillRunSchema);
