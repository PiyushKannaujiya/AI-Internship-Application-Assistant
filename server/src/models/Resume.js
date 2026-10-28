import mongoose from "mongoose";

const extractedProjectSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 200, default: "" },
    description: { type: String, trim: true, maxlength: 600, default: "" },
    technologies: { type: [String], default: [] },
    accomplishments: { type: [String], default: [] },
  },
  { _id: false }
);

const extractedCertificationSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 200, default: "" },
    issuer: { type: String, trim: true, maxlength: 200, default: "" },
    issueDate: { type: String, trim: true, maxlength: 40, default: "" },
  },
  { _id: false }
);

const proposalsSchema = new mongoose.Schema(
  {
    contact: {
      email: { type: String, trim: true, maxlength: 254, default: "" },
      phone: { type: String, trim: true, maxlength: 40, default: "" },
      linkedinUrl: { type: String, trim: true, maxlength: 500, default: "" },
      githubUrl: { type: String, trim: true, maxlength: 500, default: "" },
      portfolioUrl: { type: String, trim: true, maxlength: 500, default: "" },
    },
    headline: { type: String, trim: true, maxlength: 160, default: "" },
    skills: { type: [String], default: [] },
    projects: { type: [extractedProjectSchema], default: [] },
    certifications: { type: [extractedCertificationSchema], default: [] },
    achievements: { type: [String], default: [] },
  },
  { _id: false }
);

const resumeSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    originalName: { type: String, required: true, maxlength: 255 },
    mimeType: {
      type: String,
      required: true,
      enum: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
    },
    size: { type: Number, required: true, min: 1 },
    fileData: { type: Buffer, required: true, select: false },
    text: { type: String, required: true, maxlength: 200000, select: false },
    parsed: {
      skills: { type: [String], default: [] },
      experienceYears: { type: Number, min: 0, max: 60, default: 0 },
      educationMentions: { type: [String], default: [] },
      wordCount: { type: Number, min: 0, default: 0 },
      extractionWarning: { type: String, default: "" },
      proposals: { type: proposalsSchema, default: () => ({}) },
    },
    checksum: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.fileData;
        delete ret.text;
        delete ret.__v;
        ret.id = ret._id.toString();
        delete ret._id;
        return ret;
      },
    },
  }
);

export const Resume = mongoose.model("Resume", resumeSchema);
