import mongoose from "mongoose";

const contactSchema = new mongoose.Schema(
  {
    email: { type: String, trim: true, maxlength: 254, default: "" },
    phone: { type: String, trim: true, maxlength: 40, default: "" },
    location: { type: String, trim: true, maxlength: 160, default: "" },
    portfolioUrl: { type: String, trim: true, maxlength: 500, default: "" },
    linkedinUrl: { type: String, trim: true, maxlength: 500, default: "" },
    githubUrl: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { _id: false }
);

const accomplishmentSchema = new mongoose.Schema(
  {
    text: { type: String, trim: true, maxlength: 400, default: "" },
    verified: { type: Boolean, default: false },
  },
  { _id: false }
);

const experienceSchema = new mongoose.Schema(
  {
    company: { type: String, trim: true, maxlength: 200, default: "" },
    title: { type: String, trim: true, maxlength: 200, default: "" },
    startDate: { type: String, trim: true, maxlength: 40, default: "" },
    endDate: { type: String, trim: true, maxlength: 40, default: "" },
    current: { type: Boolean, default: false },
    description: { type: String, trim: true, maxlength: 3000, default: "" },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 200, default: "" },
    description: { type: String, trim: true, maxlength: 2000, default: "" },
    technologies: { type: [String], default: [] },
    url: { type: String, trim: true, maxlength: 500, default: "" },
    accomplishments: { type: [accomplishmentSchema], default: [] },
  },
  { _id: false }
);

const educationSchema = new mongoose.Schema(
  {
    institution: { type: String, trim: true, maxlength: 200, default: "" },
    degree: { type: String, trim: true, maxlength: 200, default: "" },
    field: { type: String, trim: true, maxlength: 200, default: "" },
    startYear: { type: Number },
    endYear: { type: Number },
    grade: { type: String, trim: true, maxlength: 100, default: "" },
  },
  { _id: false }
);

const certificationSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 200, default: "" },
    issuer: { type: String, trim: true, maxlength: 200, default: "" },
    issueDate: { type: String, trim: true, maxlength: 40, default: "" },
    expiryDate: { type: String, trim: true, maxlength: 40, default: "" },
    credentialId: { type: String, trim: true, maxlength: 120, default: "" },
    url: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { _id: false }
);

const achievementSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 200, default: "" },
    issuer: { type: String, trim: true, maxlength: 200, default: "" },
    date: { type: String, trim: true, maxlength: 40, default: "" },
    description: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { _id: false }
);

const fileSchema = new mongoose.Schema(
  {
    format: { type: String, enum: ["pdf", "docx"], required: true },
    fileName: { type: String, required: true, maxlength: 255 },
    mimeType: { type: String, required: true, maxlength: 150 },
    size: { type: Number, required: true, min: 1 },
    checksum: { type: String, required: true, maxlength: 128 },
    data: { type: Buffer, required: true, select: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const tailoredResumeSchema = new mongoose.Schema(
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
    baseResume: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Resume",
      required: true,
    },
    revision: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ["draft", "approved"],
      default: "draft",
      index: true,
    },
    approvedAt: { type: Date },
    content: {
      contact: { type: contactSchema, default: () => ({}) },
      headline: { type: String, trim: true, maxlength: 160, default: "" },
      summary: { type: String, trim: true, maxlength: 3000, default: "" },
      skills: { type: [String], default: [] },
      experience: { type: [experienceSchema], default: [] },
      projects: { type: [projectSchema], default: [] },
      education: { type: [educationSchema], default: [] },
      certifications: { type: [certificationSchema], default: [] },
      achievements: { type: [achievementSchema], default: [] },
    },
    changes: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    diff: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    provider: { type: String, enum: ["heuristic", "openai"], default: "heuristic" },
    model: { type: String, trim: true, maxlength: 120, default: "" },
    notice: { type: String, trim: true, maxlength: 1000, default: "" },
    files: { type: [fileSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.__v;
        ret.id = ret._id.toString();
        delete ret._id;
        if (Array.isArray(ret.files)) {
          ret.files = ret.files.map((file) => {
            const { data, ...metadata } = file;
            void data;
            return metadata;
          });
        }
        return ret;
      },
    },
  }
);

tailoredResumeSchema.index({ owner: 1, job: 1, revision: -1 });
tailoredResumeSchema.index({ owner: 1, createdAt: -1 });
// One revision number per owner/job; regeneration always creates a new revision.
tailoredResumeSchema.index(
  { owner: 1, job: 1, revision: 1 },
  { unique: true }
);

export const TailoredResume = mongoose.model(
  "TailoredResume",
  tailoredResumeSchema
);
