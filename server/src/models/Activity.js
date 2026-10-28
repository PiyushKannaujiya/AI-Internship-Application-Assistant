import mongoose from "mongoose";

const activitySchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "account_created",
        "profile_updated",
        "resume_uploaded",
        "resume_deleted",
        "job_saved",
        "job_created",
        "status_changed",
        "cover_letter_generated",
        "tailored_resume_generated",
        "tailored_resume_approved",
        "submitted",
      ],
      required: true,
    },
    message: { type: String, required: true, maxlength: 300 },
    job: { type: mongoose.Schema.Types.ObjectId, ref: "Job" },
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

activitySchema.index({ owner: 1, createdAt: -1 });

export const Activity = mongoose.model("Activity", activitySchema);
