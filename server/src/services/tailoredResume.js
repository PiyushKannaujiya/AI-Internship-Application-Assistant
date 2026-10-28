import { extractSkills, normalizeSkills } from "../utils/skills.js";

function tokenize(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function targetSkillSet(job) {
  const explicit = normalizeSkills(job.skills || []);
  const inferred = extractSkills(job.description || "");
  return new Set(
    [...explicit, ...inferred].map((skill) => skill.toLowerCase())
  );
}

function relevanceScore(text, skillSet, jobTokens) {
  const lower = String(text || "").toLowerCase();
  let score = 0;
  for (const skill of skillSet) {
    if (lower.includes(skill)) score += 2;
  }
  const tokens = new Set(tokenize(text));
  for (const token of tokens) {
    if (jobTokens.has(token)) score += 1;
  }
  return score;
}

function stableSort(entries, scoreOf) {
  return entries
    .map((entry, index) => ({ entry, index, score: scoreOf(entry) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.entry);
}

function sortTechnologies(technologies, skillSet) {
  return stableSort(technologies || [], (technology) =>
    skillSet.has(String(technology).toLowerCase()) ? 1 : 0
  );
}

function contactFrom(user) {
  const profile = user.profile || {};
  return {
    email: user.email || "",
    phone: profile.phone || "",
    location: profile.location || "",
    portfolioUrl: profile.portfolioUrl || "",
    linkedinUrl: profile.linkedinUrl || "",
    githubUrl: profile.githubUrl || "",
  };
}

function tailoredSummary({ profile, job, relevantSkills }) {
  const focus = relevantSkills.slice(0, 5);
  const targetLine = focus.length
    ? `Tailored for ${job.title} at ${job.company}, highlighting ${focus.join(
        ", "
      )}.`
    : `Tailored for ${job.title} at ${job.company}.`;

  return profile.summary
    ? `${targetLine}\n\n${profile.summary}`
    : targetLine;
}

/**
 * Builds tailored content from the stored profile only.
 * Unverified accomplishments are never carried into the document.
 */
export function buildTailoredResume({ user, job }) {
  const profile = user.profile || {};
  const skillSet = targetSkillSet(job);
  const jobTokens = new Set(
    tokenize(`${job.title} ${job.company} ${(job.skills || []).join(" ")}`)
  );

  const profileSkills = normalizeSkills(profile.skills || []);
  const prioritizedSkills = stableSort(profileSkills, (skill) =>
    skillSet.has(skill.toLowerCase()) ? 2 : 0
  );
  const relevantSkills = prioritizedSkills.filter((skill) =>
    skillSet.has(skill.toLowerCase())
  );

  const experience = stableSort(profile.experience || [], (entry) =>
    relevanceScore(
      `${entry.title} ${entry.company} ${entry.description}`,
      skillSet,
      jobTokens
    )
  ).map((entry) => ({
    company: entry.company || "",
    title: entry.title || "",
    startDate: entry.startDate || "",
    endDate: entry.endDate || "",
    current: Boolean(entry.current),
    description: entry.description || "",
  }));

  const excludedAccomplishments = [];
  const projects = stableSort(profile.projects || [], (project) =>
    relevanceScore(
      `${project.name} ${project.description} ${(project.technologies || []).join(
        " "
      )}`,
      skillSet,
      jobTokens
    )
  ).map((project) => {
    const verified = [];
    for (const accomplishment of project.accomplishments || []) {
      const text = String(accomplishment?.text || "").trim();
      if (!text) continue;
      if (accomplishment.verified) {
        verified.push({ text, verified: true });
      } else {
        excludedAccomplishments.push({
          project: project.name || "Untitled project",
          text,
        });
      }
    }

    return {
      name: project.name || "",
      description: project.description || "",
      technologies: sortTechnologies(project.technologies || [], skillSet),
      url: project.url || "",
      accomplishments: verified,
    };
  });

  const education = (profile.education || []).map((entry) => ({
    institution: entry.institution || "",
    degree: entry.degree || "",
    field: entry.field || "",
    startYear: entry.startYear,
    endYear: entry.endYear,
    grade: entry.grade || "",
  }));

  const certifications = (profile.certifications || []).map((entry) => ({
    name: entry.name || "",
    issuer: entry.issuer || "",
    issueDate: entry.issueDate || "",
    expiryDate: entry.expiryDate || "",
    credentialId: entry.credentialId || "",
    url: entry.url || "",
  }));

  const achievements = (profile.achievements || []).map((entry) => ({
    title: entry.title || "",
    issuer: entry.issuer || "",
    date: entry.date || "",
    description: entry.description || "",
  }));

  const content = {
    contact: contactFrom(user),
    headline: profile.headline || "",
    summary: tailoredSummary({ profile, job, relevantSkills }),
    skills: prioritizedSkills,
    experience,
    projects,
    education,
    certifications,
    achievements,
  };

  const changes = {
    summary: {
      changed: content.summary !== (profile.summary || ""),
      detail: profile.summary
        ? "Added a target-specific opening before the existing summary."
        : "Added a target-specific summary from verified profile facts.",
    },
    skills: {
      prioritized: relevantSkills,
      reordered:
        prioritizedSkills.join("|") !== profileSkills.join("|"),
      added: [],
    },
    experience: {
      order: experience.map((entry) => `${entry.title} at ${entry.company}`),
    },
    projects: {
      order: projects.map((project) => project.name),
      excludedAccomplishments,
    },
    omitted: excludedAccomplishments.map(
      (entry) =>
        `${entry.project}: "${entry.text}" was omitted because it is not marked verified.`
    ),
  };

  const diff = buildTailoredDiff({ content, profile });

  return { content, changes, diff };
}

/**
 * Recomputes the review diff for edited content against the verified profile.
 */
/**
 * Compares the tailored document with the originally uploaded resume. The
 * tailored content intentionally comes from the verified profile, so skills that
 * only exist in the old file are reported as omitted rather than copied.
 */
export function buildSourceResumeDiff({ resume, content }) {
  const sourceSkills = normalizeSkills(resume?.parsed?.skills || []);
  const tailored = new Set(
    (content.skills || []).map((skill) => skill.toLowerCase())
  );

  return {
    id: resume?._id ? String(resume._id) : null,
    originalName: resume?.originalName || "",
    wordCount: resume?.parsed?.wordCount || 0,
    skillsInOriginal: sourceSkills,
    skillsOmitted: sourceSkills.filter(
      (skill) => !tailored.has(skill.toLowerCase())
    ),
    note:
      "Tailored content is built from your verified profile, not copied from this file. Skills that only appear in the original and are not in your profile are omitted here.",
  };
}

export function buildTailoredDiff({ content, profile = {} }) {
  const originalSkills = normalizeSkills(profile.skills || []);
  const tailoredSkills = normalizeSkills(content.skills || []);
  const originalSet = new Set(originalSkills.map((skill) => skill.toLowerCase()));
  const tailoredSet = new Set(
    tailoredSkills.map((skill) => skill.toLowerCase())
  );

  const originalProjects = new Map(
    (profile.projects || []).map((project) => [
      String(project.name || "").toLowerCase(),
      project,
    ])
  );

  const projects = (content.projects || []).map((project) => {
    const original = originalProjects.get(String(project.name || "").toLowerCase());
    const originalAccomplishments = (original?.accomplishments || []).map(
      (entry) => entry.text
    );
    const tailoredAccomplishments = (project.accomplishments || []).map(
      (entry) => entry.text
    );
    return {
      name: project.name || "",
      originalAccomplishments,
      tailoredAccomplishments,
      omitted: originalAccomplishments.filter(
        (text) => !tailoredAccomplishments.includes(text)
      ),
    };
  });

  const originalOrder = (profile.experience || []).map(
    (entry) => `${entry.title} at ${entry.company}`
  );
  const tailoredOrder = (content.experience || []).map(
    (entry) => `${entry.title} at ${entry.company}`
  );

  return {
    summary: {
      original: profile.summary || "",
      tailored: content.summary || "",
      changed: (content.summary || "") !== (profile.summary || ""),
    },
    skills: {
      original: originalSkills,
      tailored: tailoredSkills,
      added: tailoredSkills.filter(
        (skill) => !originalSet.has(skill.toLowerCase())
      ),
      removed: originalSkills.filter(
        (skill) => !tailoredSet.has(skill.toLowerCase())
      ),
      reordered: tailoredSkills.join("|") !== originalSkills.join("|"),
    },
    experience: {
      originalOrder,
      tailoredOrder,
      reordered: originalOrder.join("|") !== tailoredOrder.join("|"),
    },
    projects,
    education: {
      originalCount: (profile.education || []).length,
      tailoredCount: (content.education || []).length,
    },
    certifications: {
      originalCount: (profile.certifications || []).length,
      tailoredCount: (content.certifications || []).length,
    },
    achievements: {
      originalCount: (profile.achievements || []).length,
      tailoredCount: (content.achievements || []).length,
    },
  };
}
