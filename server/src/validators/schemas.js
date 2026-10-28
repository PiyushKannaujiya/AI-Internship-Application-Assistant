import { z } from "zod";
import { APPLICATION_STATUSES } from "../models/Application.js";
import { JOB_SOURCES, JOB_TYPES } from "../models/Job.js";

const objectId = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid identifier");

const optionalUrl = z
  .union([z.literal(""), z.string().trim().url("Must be a valid URL")])
  .optional();

const stringList = (maxItems, maxLength = 80) =>
  z
    .array(z.string().trim().min(1).max(maxLength))
    .max(maxItems)
    .transform((items) => [...new Set(items.map((item) => item.trim()))]);

const optionalYear = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.number().int().min(1950).max(2100).optional()
);

const optionalHttpUrl = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .max(500)
      .url("Must be a valid URL")
      .refine(
        (value) => /^https?:\/\//i.test(value),
        "Only http(s) URLs are allowed"
      ),
  ])
  .optional();

const accomplishmentSchema = z.object({
  text: z.string().trim().min(1, "Describe the accomplishment").max(400),
  verified: z.boolean().default(false),
});

const projectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(200),
  description: z.string().trim().max(2000).default(""),
  technologies: stringList(20, 60).optional().default([]),
  url: optionalHttpUrl,
  accomplishments: z.array(accomplishmentSchema).max(10).optional().default([]),
});

const certificationSchema = z.object({
  name: z.string().trim().min(1, "Certification name is required").max(200),
  issuer: z.string().trim().max(200).default(""),
  issueDate: z.string().trim().max(40).default(""),
  expiryDate: z.string().trim().max(40).default(""),
  credentialId: z.string().trim().max(120).default(""),
  url: optionalHttpUrl,
});

const achievementSchema = z.object({
  title: z.string().trim().min(1, "Achievement title is required").max(200),
  issuer: z.string().trim().max(200).default(""),
  date: z.string().trim().max(40).default(""),
  description: z.string().trim().max(1000).default(""),
});

const answerSchema = z.object({
  question: z.string().trim().min(3, "Write the question").max(500),
  answer: z.string().trim().min(1, "Write the answer").max(5000),
  approved: z.boolean().default(false),
});

const WORK_MODES = ["onsite", "hybrid", "remote"];

export const WORK_AUTHORIZATION_STATUSES = [
  "citizen",
  "permanent_resident",
  "work_visa",
  "student_visa",
  "requires_sponsorship",
  "other",
  "prefer_not_to_say",
];

const workAuthorizationSchema = z.object({
  status: z.enum(WORK_AUTHORIZATION_STATUSES).optional(),
  requiresSponsorship: z.boolean().optional(),
  note: z.string().trim().max(300).optional(),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128)
    .regex(/[A-Za-z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a number"),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email("Enter a valid email address"),
  password: z.string().min(1, "Password is required").max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128)
    .regex(/[A-Za-z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a number"),
});

const educationSchema = z.object({
  institution: z.string().trim().max(200).default(""),
  degree: z.string().trim().max(200).default(""),
  field: z.string().trim().max(200).default(""),
  startYear: optionalYear,
  endYear: optionalYear,
  grade: z.string().trim().max(100).default(""),
});

const experienceSchema = z.object({
  company: z.string().trim().max(200).default(""),
  title: z.string().trim().max(200).default(""),
  startDate: z.string().trim().max(40).default(""),
  endDate: z.string().trim().max(40).default(""),
  current: z.boolean().default(false),
  description: z.string().trim().max(3000).default(""),
});

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  profile: z
    .object({
      headline: z.string().trim().max(160).optional(),
      summary: z.string().trim().max(3000).optional(),
      phone: z.string().trim().max(40).optional(),
      location: z.string().trim().max(160).optional(),
      portfolioUrl: optionalUrl,
      linkedinUrl: optionalUrl,
      githubUrl: optionalUrl,
      skills: stringList(50).optional(),
      education: z.array(educationSchema).max(10).optional(),
      experience: z.array(experienceSchema).max(15).optional(),
      preferredRoles: stringList(20, 120).optional(),
      preferredLocations: stringList(20, 120).optional(),
      projects: z.array(projectSchema).max(20).optional(),
      certifications: z.array(certificationSchema).max(20).optional(),
      achievements: z.array(achievementSchema).max(20).optional(),
      answerBank: z.array(answerSchema).max(50).optional(),
      workAuthorization: workAuthorizationSchema.optional(),
      jobPreferences: z
        .object({
          jobTypes: z.array(z.enum(JOB_TYPES)).max(6).optional(),
          remoteOnly: z.boolean().optional(),
          workModes: z.array(z.enum(WORK_MODES)).max(3).optional(),
          willRelocate: z.boolean().optional(),
          availability: z.string().trim().max(120).optional(),
          noticePeriod: z.string().trim().max(120).optional(),
          minimumStipend: z.string().trim().max(120).optional(),
        })
        .optional(),
    })
    .optional(),
});

export const jobCreateSchema = z.object({
  title: z.string().trim().min(2).max(250),
  company: z.string().trim().min(1).max(200),
  description: z.string().trim().min(10, "Description must be at least 10 characters").max(30000),
  skills: stringList(60, 60).optional().default([]),
  location: z.string().trim().max(200).optional().default("Not specified"),
  jobType: z.enum(JOB_TYPES).optional().default("other"),
  remote: z.boolean().optional().default(false),
  applicationUrl: z.string().trim().url("Enter a valid application URL").max(2000),
  postedAt: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.date().optional()
  ),
});

export const jobUpdateSchema = jobCreateSchema.partial();

export const jobListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  jobType: z.enum(JOB_TYPES).optional(),
  remote: z.enum(["true", "false"]).optional(),
  source: z.enum(JOB_SOURCES).optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  sort: z.enum(["newest", "oldest", "title", "company", "postedAt"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const sourceList = z
  .string()
  .trim()
  .max(200)
  .transform((value) =>
    [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))]
  )
  .refine((values) => values.length > 0, {
    message: "Choose at least one job source",
  });

const boardList = z.string().trim().max(300).optional();

export const discoverQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  location: z.string().trim().max(200).optional(),
  remote: z.enum(["true", "false"]).optional(),
  jobType: z.enum(JOB_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sources: sourceList.optional(),
  greenhouse: boardList,
  lever: boardList,
  ashby: boardList,
  workable: boardList,
  smartrecruiters: boardList,
});

// Only providers with an adapter can be imported by id.
export const IMPORTABLE_SOURCES = [
  "remotive",
  "jobicy",
  "arbeitnow",
  "greenhouse",
  "lever",
  "ashby",
  "remoteok",
  "adzuna",
  "workable",
  "smartrecruiters",
];

export const importJobSchema = z.object({
  externalId: z.string().trim().min(1).max(120),
  source: z.enum(IMPORTABLE_SOURCES).optional().default("remotive"),
  board: z.string().trim().max(80).optional(),
});

export const urlImportSchema = z.object({
  url: z.string().trim().min(8).max(2000),
  save: z.boolean().optional().default(false),
});

export const applicationUpdateSchema = z
  .object({
    status: z.enum(APPLICATION_STATUSES).optional(),
    notes: z.string().trim().max(5000).optional(),
    coverLetter: z
      .object({
        subject: z.string().trim().max(300).default(""),
        body: z.string().trim().max(10000).default(""),
      })
      .optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.notes !== undefined ||
      value.coverLetter !== undefined,
    { message: "Provide a status, notes, or cover letter to update" }
  );

export const applicationCreateSchema = z.object({
  jobId: objectId,
  status: z.enum(APPLICATION_STATUSES).optional().default("planned"),
});

export const submitApplicationSchema = z.object({
  approved: z.boolean().refine((value) => value === true, {
    message: "Explicit approval is required before marking an application submitted",
  }),
  method: z.enum(["manual", "assisted_manual"]).default("manual"),
  confirmation: z.boolean().refine((value) => value === true, {
    message: "Confirm that you submitted the application yourself",
  }),
});

export const applicationListQuerySchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const resumeExtractionApplySchema = z.object({
  reviewed: z.boolean().refine((value) => value === true, {
    message: "Review the extracted data before applying it",
  }),
  overwriteVerified: z.boolean().default(false),
  fields: z
    .object({
      headline: z.string().trim().max(160).optional(),
      summary: z.string().trim().max(3000).optional(),
      phone: z.string().trim().max(40).optional(),
      location: z.string().trim().max(160).optional(),
      portfolioUrl: optionalHttpUrl,
      linkedinUrl: optionalHttpUrl,
      githubUrl: optionalHttpUrl,
    })
    .optional(),
  skills: stringList(50).optional(),
  projects: z.array(projectSchema).max(20).optional(),
  certifications: z.array(certificationSchema).max(20).optional(),
  achievements: z.array(achievementSchema).max(20).optional(),
  education: z.array(educationSchema).max(10).optional(),
});

const tailoredContactSchema = z.object({
  email: z.union([z.literal(""), z.string().trim().max(254).email()]).optional(),
  phone: z.string().trim().max(40).optional(),
  location: z.string().trim().max(160).optional(),
  portfolioUrl: optionalHttpUrl,
  linkedinUrl: optionalHttpUrl,
  githubUrl: optionalHttpUrl,
});

export const tailoredContentSchema = z.object({
  contact: tailoredContactSchema.optional(),
  headline: z.string().trim().max(160).optional(),
  summary: z.string().trim().max(3000).optional(),
  skills: stringList(50, 80).optional(),
  experience: z.array(experienceSchema).max(15).optional(),
  projects: z.array(projectSchema).max(20).optional(),
  education: z.array(educationSchema).max(10).optional(),
  certifications: z.array(certificationSchema).max(20).optional(),
  achievements: z.array(achievementSchema).max(20).optional(),
});

export const tailoredResumeCreateSchema = z.object({
  jobId: objectId,
});

export const tailoredResumeUpdateSchema = z.object({
  content: tailoredContentSchema,
});

export const tailoredResumeApproveSchema = z.object({
  approved: z.boolean().refine((value) => value === true, {
    message: "Explicit approval is required before a tailored resume can be used",
  }),
});

export const tailoredResumeListQuerySchema = z.object({
  jobId: objectId.optional(),
});

export const idParamsSchema = z.object({ id: objectId });

export const tailoredDownloadParamsSchema = z.object({
  id: objectId,
  format: z.enum(["pdf", "docx"]),
});

export const aiJobRequestSchema = z.object({
  jobId: objectId,
  tone: z.enum(["professional", "enthusiastic", "concise"]).default("professional"),
});

export const aiAnswersSchema = z.object({
  jobId: objectId,
  questions: z
    .array(z.string().trim().min(3).max(500))
    .min(1, "Provide at least one question")
    .max(10, "At most 10 questions are allowed"),
});

export const readinessRequirementsSchema = z.object({
  coverLetter: z.enum(["required", "recommended", "off"]).optional(),
  questions: z
    .array(z.string().trim().min(3).max(500))
    .max(20, "At most 20 screening questions are allowed")
    .optional(),
});

export const readinessEvaluateSchema = z.object({
  requirements: readinessRequirementsSchema.optional(),
});

export const adapterDetectQuerySchema = z.object({
  url: z.string().trim().min(8).max(2000),
});

const autofillFilledFieldSchema = z.object({
  canonical: z.string().trim().max(80).default(""),
  label: z.string().trim().max(160).default(""),
  selector: z.string().trim().max(300).default(""),
});

const autofillMissingFieldSchema = z.object({
  canonical: z.string().trim().max(80).default(""),
  label: z.string().trim().max(160).default(""),
  reason: z.string().trim().max(200).default(""),
});

const autofillValidationErrorSchema = z.object({
  field: z.string().trim().max(160).default(""),
  message: z.string().trim().max(300).default(""),
});

export const autofillRunSchema = z
  .object({
    adapter: z.string().trim().min(1).max(60),
    pageUrl: z.string().trim().max(2000).default(""),
    status: z.enum(["prepared", "needs_review", "failed"]).default("prepared"),
    filledFields: z.array(autofillFilledFieldSchema).max(80).default([]),
    missingFields: z.array(autofillMissingFieldSchema).max(80).default([]),
    validationErrors: z
      .array(autofillValidationErrorSchema)
      .max(50)
      .default([]),
    unsupportedControls: z.array(z.string().trim().max(200)).max(30).default([]),
    blockedBy: z
      .array(z.enum(["captcha", "otp", "mfa", "login", "terms", "unsupported_form"]))
      .max(6)
      .default([]),
    resumeUploaded: z
      .object({
        format: z.enum(["pdf", "docx"]).default("pdf"),
        fileName: z.string().trim().max(255).default(""),
      })
      .nullish(),
    coverLetterFilled: z.boolean().default(false),
    answersFilled: z.array(z.string().trim().max(500)).max(20).default([]),
    botProtection: z
      .object({
        detected: z.boolean().default(false),
        visibleChallenge: z.boolean().default(false),
        kinds: z.array(z.string().trim().max(40)).max(5).default([]),
      })
      .optional(),
    submitted: z.boolean().optional(),
    notes: z.string().trim().max(500).default(""),
  })
  .refine((value) => value.submitted !== true, {
    message:
      "An autofill run can never claim a submission. Submit the application yourself from the browser.",
    path: ["submitted"],
  });

export const autofillRunListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
