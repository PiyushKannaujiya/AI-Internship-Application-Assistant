import { approvedAnswerBank } from "../readiness.js";
import { FIELD_LABELS, applicationFormUrl } from "./adapters.js";
import { SAFETY_POLICY } from "./safety.js";

const WORK_AUTHORIZATION_LABELS = {
  citizen: "Citizen",
  permanent_resident: "Permanent resident",
  work_visa: "Work visa",
  student_visa: "Student visa",
  requires_sponsorship: "Requires sponsorship",
  other: "Other",
  prefer_not_to_say: "",
};

function splitName(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function latestEducation(profile = {}) {
  const entries = (profile.education || []).filter(
    (entry) => entry.institution || entry.degree
  );
  return [...entries].sort((a, b) => (b.endYear || 0) - (a.endYear || 0))[0] || null;
}

function currentRole(profile = {}) {
  const entries = profile.experience || [];
  const current = entries.find((entry) => entry.current) || entries[0];
  return current || null;
}

/**
 * Values are drawn only from the account, the verified profile, or an approved
 * tailored revision. Draft revisions are deliberately ignored.
 */
export function buildFieldValues({ user, approvedResume }) {
  const profile = user.profile || {};
  const { firstName, lastName } = splitName(user.name);
  const education = latestEducation(profile);
  const role = currentRole(profile);
  const approvedContent = approvedResume?.content || null;
  const approvedSkills = (approvedContent?.skills || []).filter(Boolean);
  const profileSkills = (profile.skills || []).filter(Boolean);
  const authorization = profile.workAuthorization || {};

  return {
    values: {
      fullName: user.name || "",
      firstName,
      lastName,
      email: user.email || "",
      phone: profile.phone || "",
      location: profile.location || "",
      linkedinUrl: profile.linkedinUrl || "",
      githubUrl: profile.githubUrl || "",
      portfolioUrl: profile.portfolioUrl || "",
      headline: profile.headline || "",
      currentTitle: role?.title || "",
      currentCompany: role?.company || "",
      skills: (approvedSkills.length ? approvedSkills : profileSkills).join(", "),
      summary: approvedContent?.summary || profile.summary || "",
      latestSchool: education?.institution || "",
      latestDegree: education?.degree || "",
      latestField: education?.field || "",
      latestGraduationYear: education?.endYear ? String(education.endYear) : "",
      workAuthorization: WORK_AUTHORIZATION_LABELS[authorization.status] || "",
      requiresSponsorship:
        authorization.status && authorization.status !== "prefer_not_to_say"
          ? authorization.requiresSponsorship
            ? "Yes"
            : "No"
          : "",
    },
    sources: {
      fullName: "account",
      firstName: "account",
      lastName: "account",
      email: "account",
      phone: "profile",
      location: "profile",
      linkedinUrl: "profile",
      githubUrl: "profile",
      portfolioUrl: "profile",
      headline: "profile",
      currentTitle: "profile",
      currentCompany: "profile",
      skills: approvedSkills.length ? "approved_tailored_resume" : "profile",
      summary: approvedContent?.summary
        ? "approved_tailored_resume"
        : "profile",
      latestSchool: "profile",
      latestDegree: "profile",
      latestField: "profile",
      latestGraduationYear: "profile",
      workAuthorization: "profile",
      requiresSponsorship: "profile",
    },
  };
}

export function buildEducationSnapshot(profile = {}) {
  return (profile.education || []).map((entry) => ({
    institution: entry.institution || "",
    degree: entry.degree || "",
    field: entry.field || "",
    startYear: entry.startYear ?? null,
    endYear: entry.endYear ?? null,
    grade: entry.grade || "",
  }));
}

export function buildExperienceSnapshot(profile = {}) {
  return (profile.experience || []).map((entry) => ({
    company: entry.company || "",
    title: entry.title || "",
    startDate: entry.startDate || "",
    endDate: entry.endDate || "",
    current: Boolean(entry.current),
    description: entry.description || "",
  }));
}

/** Projects are included with verified accomplishments only. */
export function buildProjectSnapshot(profile = {}) {
  return (profile.projects || []).map((project) => ({
    name: project.name || "",
    description: project.description || "",
    technologies: [...(project.technologies || [])],
    url: project.url || "",
    accomplishments: (project.accomplishments || [])
      .filter((entry) => entry?.verified && entry.text)
      .map((entry) => entry.text),
  }));
}

export function buildAutofillPlan({
  user,
  job,
  application,
  approvedResume,
  adapter,
}) {
  const { values, sources } = buildFieldValues({ user, approvedResume });
  const profile = user.profile || {};
  const blockers = [];

  if (!adapter.supported || !adapter.autofillSupported) {
    blockers.push({
      code: "unsupported_portal",
      detail:
        adapter.unsupportedReason ||
        "This portal has no maintained autofill adapter. Use the manual fallback.",
    });
  }

  const resumeFiles = (approvedResume?.files || []).map((file) => ({
    format: file.format,
    fileName: file.fileName,
    mimeType: file.mimeType,
    size: file.size,
    checksum: file.checksum,
    downloadPath: `/api/tailored-resumes/${String(
      approvedResume?._id || approvedResume?.id
    )}/download/${file.format}`,
  }));

  if (!approvedResume) {
    blockers.push({
      code: "no_approved_resume",
      detail: "Approve a tailored resume for this job before running autofill.",
    });
  } else if (!resumeFiles.some((file) => file.format === "pdf")) {
    blockers.push({
      code: "missing_pdf",
      detail: "The approved revision has no PDF file to upload.",
    });
  }

  if (application.status === "submitted") {
    blockers.push({
      code: "already_submitted",
      detail:
        "This application is already recorded as submitted. Autofill is disabled to avoid a duplicate application.",
    });
  }

  const mappedFields = adapter.supported
    ? adapter.fields
        .map((field) => {
          const value = values[field.canonical];
          if (!value) return null;
          return {
            canonical: field.canonical,
            label: FIELD_LABELS[field.canonical] || field.canonical,
            value,
            source: sources[field.canonical] || "profile",
            selectors: field.selectors,
            labels: field.labels || [],
            control: "text",
          };
        })
        .filter(Boolean)
    : [];

  const missingFields = adapter.supported
    ? adapter.fields
        .filter((field) => !values[field.canonical])
        .map((field) => ({
          canonical: field.canonical,
          label: FIELD_LABELS[field.canonical] || field.canonical,
          reason: "not_in_verified_profile",
        }))
    : [];

  const coverLetter = String(application.coverLetter?.body || "").trim();
  const listingUrl = job.applicationUrl;
  const formUrl = applicationFormUrl(listingUrl);

  // Every verified value is available for manual copy/paste even when a portal
  // has no matching input, so nothing has to be retyped from memory.
  const manualValues = Object.entries(values)
    .filter(([, value]) => value)
    .map(([canonical, value]) => ({
      canonical,
      label: FIELD_LABELS[canonical] || canonical,
      value,
      source: sources[canonical] || "profile",
    }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    applicationId: String(application._id || application.id),
    jobId: String(job._id || job.id),
    job: {
      title: job.title,
      company: job.company,
      // The helper opens the form URL. Keep the saved listing URL visible so
      // the adjustment is auditable and reversible.
      applicationUrl: formUrl,
      listingUrl,
      applicationUrlAdjusted: formUrl !== listingUrl,
    },
    adapter: {
      key: adapter.key,
      name: adapter.name,
      supported: Boolean(adapter.supported),
      autofillSupported: Boolean(adapter.autofillSupported),
      resumeUploadSupported: Boolean(adapter.resumeUploadSupported),
      requiresLogin: Boolean(adapter.requiresLogin),
      matchedHost: adapter.matchedHost || "",
      notes: adapter.notes || "",
      limitations: adapter.limitations || [],
      unsupportedReason: adapter.unsupportedReason || "",
    },
    canAutofill: blockers.length === 0,
    blockers,
    fields: mappedFields,
    manualValues,
    missingFields,
    resume: approvedResume
      ? {
          tailoredResumeId: String(approvedResume._id || approvedResume.id),
          revision: approvedResume.revision,
          approvedAt: approvedResume.approvedAt,
          files: resumeFiles,
          selectors: adapter.resumeSelectors || [],
        }
      : null,
    coverLetter: coverLetter
      ? {
          subject: application.coverLetter?.subject || "",
          body: coverLetter,
          selectors: adapter.coverLetterSelectors || [],
        }
      : null,
    answers: approvedAnswerBank(profile),
    education: buildEducationSnapshot(profile),
    experience: buildExperienceSnapshot(profile),
    projects: buildProjectSnapshot(profile),
    answerSelectorHint: (adapter.answerSelectors || []).join(", "),
    safety: { ...SAFETY_POLICY },
    manualFallback: {
      supported: true,
      reason:
        blockers.find((blocker) => blocker.code === "unsupported_portal")?.detail ||
        "",
      prefillEndpoint: `/api/applications/${String(
        application._id || application.id
      )}/preview`,
      instructions: [
        "Open the employer's application page in your own browser.",
        "Copy values from the application preview or this plan, checking each one.",
        "Attach the approved tailored resume yourself.",
        "Submit only when you have read the whole form.",
      ],
    },
    helper: {
      command: "node tools/autofill/cli.js --plan <path-to-this-file>",
      requiresLocalPlaywright: true,
      visibleBrowser: true,
    },
  };
}
