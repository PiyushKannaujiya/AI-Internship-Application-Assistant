import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";

const educationSchema = new mongoose.Schema(
  {
    institution: { type: String, trim: true, maxlength: 200, default: "" },
    degree: { type: String, trim: true, maxlength: 200, default: "" },
    field: { type: String, trim: true, maxlength: 200, default: "" },
    startYear: { type: Number, min: 1950, max: 2100 },
    endYear: { type: Number, min: 1950, max: 2100 },
    grade: { type: String, trim: true, maxlength: 100, default: "" },
  },
  { _id: true }
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
  { _id: true }
);

const accomplishmentSchema = new mongoose.Schema(
  {
    text: { type: String, trim: true, maxlength: 400, default: "" },
    verified: { type: Boolean, default: false },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 200, default: "" },
    description: { type: String, trim: true, maxlength: 2000, default: "" },
    technologies: {
      type: [String],
      default: [],
      validate: {
        validator: (value) => value.length <= 20,
        message: "A project can list at most 20 technologies",
      },
    },
    url: { type: String, trim: true, maxlength: 500, default: "" },
    accomplishments: {
      type: [accomplishmentSchema],
      default: [],
      validate: {
        validator: (value) => value.length <= 10,
        message: "A project can list at most 10 accomplishments",
      },
    },
  },
  { _id: true }
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
  { _id: true }
);

const achievementSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 200, default: "" },
    issuer: { type: String, trim: true, maxlength: 200, default: "" },
    date: { type: String, trim: true, maxlength: 40, default: "" },
    description: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { _id: true }
);

const answerSchema = new mongoose.Schema(
  {
    question: { type: String, trim: true, maxlength: 500, default: "" },
    answer: { type: String, trim: true, maxlength: 5000, default: "" },
    approved: { type: Boolean, default: false },
    approvedAt: { type: Date },
  },
  { _id: true }
);

const profileSchema = new mongoose.Schema(
  {
    headline: { type: String, trim: true, maxlength: 160, default: "" },
    summary: { type: String, trim: true, maxlength: 3000, default: "" },
    phone: { type: String, trim: true, maxlength: 40, default: "" },
    location: { type: String, trim: true, maxlength: 160, default: "" },
    portfolioUrl: { type: String, trim: true, maxlength: 500, default: "" },
    linkedinUrl: { type: String, trim: true, maxlength: 500, default: "" },
    githubUrl: { type: String, trim: true, maxlength: 500, default: "" },
    skills: {
      type: [String],
      default: [],
      validate: {
        validator: (value) => value.length <= 50,
        message: "A profile can list at most 50 skills",
      },
    },
    education: {
      type: [educationSchema],
      default: [],
      validate: {
        validator: (value) => value.length <= 10,
        message: "At most 10 education entries are allowed",
      },
    },
    experience: {
      type: [experienceSchema],
      default: [],
      validate: {
        validator: (value) => value.length <= 15,
        message: "At most 15 experience entries are allowed",
      },
    },
    projects: {
      type: [projectSchema],
      default: [],
      validate: {
        validator: (value) => value.length <= 20,
        message: "At most 20 projects are allowed",
      },
    },
    certifications: {
      type: [certificationSchema],
      default: [],
      validate: {
        validator: (value) => value.length <= 20,
        message: "At most 20 certifications are allowed",
      },
    },
    achievements: {
      type: [achievementSchema],
      default: [],
      validate: {
        validator: (value) => value.length <= 20,
        message: "At most 20 achievements are allowed",
      },
    },
    answerBank: {
      type: [answerSchema],
      default: [],
      validate: {
        validator: (value) => value.length <= 50,
        message: "At most 50 saved answers are allowed",
      },
    },
    workAuthorization: {
      status: {
        type: String,
        enum: [
          "citizen",
          "permanent_resident",
          "work_visa",
          "student_visa",
          "requires_sponsorship",
          "other",
          "prefer_not_to_say",
        ],
        default: "prefer_not_to_say",
      },
      requiresSponsorship: { type: Boolean, default: false },
      note: { type: String, trim: true, maxlength: 300, default: "" },
    },
    preferredRoles: {
      type: [String],
      default: [],
      validate: {
        validator: (value) => value.length <= 20,
        message: "At most 20 preferred roles are allowed",
      },
    },
    preferredLocations: {
      type: [String],
      default: [],
      validate: {
        validator: (value) => value.length <= 20,
        message: "At most 20 preferred locations are allowed",
      },
    },
    jobPreferences: {
      jobTypes: {
        type: [String],
        enum: ["internship", "full-time", "part-time", "contract", "temporary", "other"],
        default: [],
      },
      remoteOnly: { type: Boolean, default: false },
      workModes: {
        type: [String],
        enum: ["onsite", "hybrid", "remote"],
        default: [],
      },
      willRelocate: { type: Boolean, default: false },
      availability: { type: String, trim: true, maxlength: 120, default: "" },
      noticePeriod: { type: String, trim: true, maxlength: 120, default: "" },
      minimumStipend: { type: String, trim: true, maxlength: 120, default: "" },
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    tokenVersion: {
      type: Number,
      default: 0,
      select: false,
    },
    profile: {
      type: profileSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.tokenVersion;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.passwordHash);
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
  const safe = this.toJSON();
  safe.id = safe._id.toString();
  delete safe._id;
  return safe;
};

export const User = mongoose.model("User", userSchema);

export async function hashPassword(password) {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}
