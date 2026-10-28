import mongoose from "mongoose";

export const APPLICATION_STATUSES = [
  "saved",
  "planned",
  "in_progress",
  "submitted",
  "interview",
  "rejected",
  "offer",
];

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, enum: APPLICATION_STATUSES, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const applicationSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: APPLICATION_STATUSES,
      default: "saved",
      index: true,
    },
    notes: { type: String, trim: true, maxlength: 5000, default: "" },
    coverLetter: {
      subject: { type: String, trim: true, maxlength: 300, default: "" },
      body: { type: String, trim: true, maxlength: 10000, default: "" },
      provider: { type: String, trim: true, maxlength: 40, default: "" },
      generatedAt: { type: Date },
    },
    statusHistory: { type: [statusHistorySchema], default: [] },
    submittedAt: { type: Date },
    submissionMethod: {
      type: String,
      enum: ["none", "manual", "assisted_manual"],
      default: "none",
    },
    lastError: { type: String, trim: true, maxlength: 1000, default: "" },
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

applicationSchema.index({ owner: 1, job: 1 }, { unique: true });
applicationSchema.index({ owner: 1, status: 1, updatedAt: -1 });

export const Application = mongoose.model("Application", applicationSchema);
