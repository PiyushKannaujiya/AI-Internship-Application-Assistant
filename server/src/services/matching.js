import {
  extractSkills,
  normalizeSkills,
} from "../utils/skills.js";

const WEIGHTS = {
  skills: 0.55,
  experience: 0.2,
  role: 0.15,
  location: 0.1,
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function tokenize(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function roleFit(job, profile) {
  const jobTokens = new Set(
    tokenize(`${job.title} ${job.company} ${(job.skills || []).join(" ")}`)
  );
  const preferences = [
    ...(profile.preferredRoles || []),
    profile.headline || "",
  ].filter(Boolean);

  if (!preferences.length) {
    return {
      score: 0.6,
      reason: "No preferred roles set, so role alignment is neutral.",
    };
  }

  let best = 0;
  for (const preference of preferences) {
    const tokens = tokenize(preference);
    if (!tokens.length) continue;
    const hits = tokens.filter((token) => jobTokens.has(token)).length;
    best = Math.max(best, hits / tokens.length);
  }

  return {
    score: clamp(0.45 + best * 0.55),
    reason:
      best > 0
        ? "Your preferred roles overlap with this job title."
        : "This role does not strongly overlap with your preferred roles.",
  };
}

function locationFit(job, profile) {
  const preferences = (profile.preferredLocations || []).filter(Boolean);
  const location = (job.location || "").toLowerCase();

  if (job.remote) {
    return {
      score: preferences.some((item) => /remote|anywhere/i.test(item)) ? 1 : 0.9,
      reason: "This is a remote role.",
    };
  }

  if (!preferences.length) {
    return {
      score: 0.6,
      reason: "No preferred locations set, so location is weighted neutrally.",
    };
  }

  const matches = preferences.some(
    (preference) =>
      location.includes(preference.toLowerCase()) ||
      preference.toLowerCase().includes(location)
  );

  return {
    score: matches ? 1 : 0.3,
    reason: matches
      ? "The job location matches one of your preferred locations."
      : "The job location does not match your preferred locations.",
  };
}

function requiredYears(description = "") {
  let required = 0;
  for (const match of String(description).matchAll(
    /(\d{1,2})\+?\s*(?:years?|yrs?)\b/gi
  )) {
    required = Math.max(required, Number(match[1]));
  }
  return Math.min(15, required);
}

function experienceFit(job, userYears) {
  const required = requiredYears(job.description);

  if (required === 0) {
    return {
      score: userYears > 0 ? 0.85 : 0.6,
      requiredYears: 0,
      reason:
        userYears > 0
          ? "The posting has no explicit experience requirement and your resume shows experience."
          : "The posting has no explicit experience requirement.",
    };
  }

  const score = clamp(userYears / required);
  return {
    score,
    requiredYears: required,
    reason:
      score >= 1
        ? `Your ~${userYears} year(s) of experience meets the ${required}+ year requirement.`
        : `The posting asks for ${required}+ years; your resume suggests ~${userYears} year(s).`,
  };
}

function profileExperienceYears(profile) {
  let total = 0;
  const currentYear = new Date().getUTCFullYear();

  for (const entry of profile.experience || []) {
    const start = Number(String(entry.startDate || "").match(/(19|20)\d{2}/)?.[0]);
    if (!start) continue;
    const end = entry.current
      ? currentYear
      : Number(String(entry.endDate || "").match(/(19|20)\d{2}/)?.[0]) ||
        currentYear;
    if (start <= end) total += end - start;
  }

  return Math.min(40, total);
}

export function buildMatch({ job, user, resume }) {
  const profile = user.profile || {};
  const resumeText = resume?.text || "";
  const resumeSkills = resume?.parsed?.skills || [];
  const profileSkills = profile.skills || [];
  const projectSkills = (profile.projects || []).flatMap(
    (project) => project.technologies || []
  );
  const candidateSkills = normalizeSkills([
    ...profileSkills,
    ...projectSkills,
    ...resumeSkills,
    ...extractSkills(resumeText),
  ]);

  let jobSkills = normalizeSkills(job.skills || []);
  if (jobSkills.length === 0) {
    jobSkills = extractSkills(job.description || "").slice(0, 12);
  }

  const candidateLower = new Map(
    candidateSkills.map((skill) => [skill.toLowerCase(), skill])
  );
  const matchedSkills = [];
  const missingSkills = [];

  for (const skill of jobSkills) {
    if (candidateLower.has(skill.toLowerCase())) {
      matchedSkills.push(candidateLower.get(skill.toLowerCase()));
    } else {
      missingSkills.push(skill);
    }
  }

  const skillScore =
    jobSkills.length > 0 ? matchedSkills.length / jobSkills.length : 0.5;
  const skillReason =
    jobSkills.length > 0
      ? `You match ${matchedSkills.length} of ${jobSkills.length} identified job skills.`
      : "This job lists no recognizable skills, so the skills score is neutral.";

  const userYears = Math.max(
    resume?.parsed?.experienceYears || 0,
    profileExperienceYears(profile)
  );
  const experience = experienceFit(job, userYears);
  const role = roleFit(job, profile);
  const location = locationFit(job, profile);

  const score = Math.round(
    (skillScore * WEIGHTS.skills +
      experience.score * WEIGHTS.experience +
      role.score * WEIGHTS.role +
      location.score * WEIGHTS.location) *
      100
  );

  const reasons = [
    skillReason,
    experience.reason,
    role.reason,
    location.reason,
  ];

  const suggestions = [];

  if (missingSkills.length) {
    suggestions.push({
      title: "Address the skill gaps",
      detail: `The posting mentions ${missingSkills
        .slice(0, 5)
        .join(", ")}. Add only skills you genuinely have, with a project or work example.`,
    });
  }

  if (!resume) {
    suggestions.push({
      title: "Upload your resume",
      detail:
        "Add a PDF or DOCX resume so matching can use your actual experience and skills.",
    });
  }

  if (!profile.headline || !profile.summary) {
    suggestions.push({
      title: "Complete your professional summary",
      detail:
        "A short headline and summary help tailor matching and generated application content.",
    });
  }

  if (resume && (resume.parsed?.wordCount || 0) < 150) {
    suggestions.push({
      title: "Add more evidence to your resume",
      detail:
        "Your resume has limited text. Include projects, technologies, and measurable outcomes.",
    });
  }

  suggestions.push({
    title: "Tailor your top section",
    detail: `Lead with your strongest overlap for ${job.title} at ${job.company}: ${
      matchedSkills.slice(0, 5).join(", ") || "your most relevant projects"
    }.`,
  });

  return {
    score: Math.min(100, Math.max(0, score)),
    method: "heuristic",
    matchedSkills,
    missingSkills,
    userSkills: candidateSkills,
    components: {
      skills: Math.round(skillScore * 100),
      experience: Math.round(experience.score * 100),
      role: Math.round(role.score * 100),
      location: Math.round(location.score * 100),
    },
    experience: {
      userYears,
      requiredYears: experience.requiredYears,
    },
    weights: WEIGHTS,
    reasons,
    suggestions,
  };
}

export function summarizeMatchForPrompt(match) {
  return [
    `Match score: ${match.score}/100`,
    `Matched skills: ${match.matchedSkills.join(", ") || "none identified"}`,
    `Missing skills: ${match.missingSkills.join(", ") || "none identified"}`,
    `Experience: ~${match.experience.userYears} years; posting asks for ${match.experience.requiredYears || "no explicit"}`,
  ].join("\n");
}
