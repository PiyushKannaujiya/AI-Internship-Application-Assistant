import { extractSkills } from "../utils/skills.js";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_PATTERN = /(\+?\d[\d\s().-]{7,}\d)/g;
const LINKEDIN_PATTERN = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s,;)]+/i;
const GITHUB_PATTERN = /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s,;)]+/i;
const URL_PATTERN = /https?:\/\/[^\s,;)]+/i;

const SECTION_HEADINGS = [
  "experience",
  "work experience",
  "professional experience",
  "education",
  "skills",
  "technical skills",
  "projects",
  "personal projects",
  "academic projects",
  "selected projects",
  "certifications",
  "certificates",
  "achievements",
  "awards",
  "honors",
  "summary",
  "profile",
  "contact",
  "publications",
  "volunteer",
];

const ROLE_KEYWORDS =
  /(engineer|developer|intern|designer|analyst|manager|scientist|consultant|architect|administrator|student|specialist)/i;
const EDUCATION_KEYWORDS =
  /(university|college|institute|bachelor|master|b\.?tech|m\.?tech|b\.?sc|m\.?sc|bca|mca|mba|ph\.?d|diploma)/i;
const CERTIFICATION_KEYWORDS =
  /(certifi|certified|coursera|udemy|nptel|edx|aws|google cloud|azure|scrum|pmp|\bcka\b|\bckad\b)/i;
const ACHIEVEMENT_KEYWORDS =
  /(award|winner|won |rank|scholarship|hackathon|finalist|medal|dean'?s list|top \d+)/i;
const BULLET_PATTERN = /^(?:[-•*·▪◦‣]|\d+[.)])\s+/;

function normalizeUrl(value, fallbackProtocol = "https://") {
  if (!value) return "";
  const trimmed = value.trim().replace(/[.,;:]+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${fallbackProtocol}${trimmed.replace(/^\/\//, "")}`;
}

function isSectionHeading(line) {
  const normalized = line
    .trim()
    .replace(/[:\s]+$/, "")
    .toLowerCase();

  if (!normalized || normalized.length > 60) return false;
  if (SECTION_HEADINGS.includes(normalized)) return true;

  // ALL-CAPS headings such as "TECHNICAL SKILLS" or "AWARDS & HONORS".
  if (/^[A-Z][A-Z\s&/-]{3,}$/.test(line.trim())) return true;

  return false;
}

function sectionLines(lines, headingMatcher) {
  const start = lines.findIndex((line) => headingMatcher.test(line.trim()));
  if (start === -1) return [];

  const collected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      if (collected.length && collected[collected.length - 1] !== "") {
        collected.push("");
      }
      continue;
    }
    if (isSectionHeading(line)) break;
    collected.push(line);
    if (collected.filter(Boolean).length >= 18) break;
  }

  return collected.filter(Boolean);
}

function uniqueBy(items, keySelector) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keySelector(item).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

export function extractContactInfo(text = "") {
  if (typeof text !== "string" || !text.trim()) {
    return {
      email: "",
      phone: "",
      linkedinUrl: "",
      githubUrl: "",
      portfolioUrl: "",
    };
  }

  const email = text.match(EMAIL_PATTERN)?.[0]?.toLowerCase() || "";

  let phone = "";
  for (const match of text.matchAll(PHONE_PATTERN)) {
    const candidate = match[1].trim();
    const digits = candidate.replace(/\D/g, "");
    // Skip year ranges like "2022 - 2026" and unrealistic numbers.
    if (digits.length >= 8 && digits.length <= 15 && !/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/.test(candidate)) {
      phone = candidate.replace(/\s{2,}/g, " ");
      break;
    }
  }

  const linkedinUrl = normalizeUrl(text.match(LINKEDIN_PATTERN)?.[0]);
  const githubUrl = normalizeUrl(text.match(GITHUB_PATTERN)?.[0]);

  let portfolioUrl = "";
  for (const match of text.matchAll(new RegExp(URL_PATTERN.source, "gi"))) {
    const candidate = match[0];
    if (/linkedin\.com|github\.com/i.test(candidate)) continue;
    portfolioUrl = normalizeUrl(candidate);
    break;
  }

  return { email, phone, linkedinUrl, githubUrl, portfolioUrl };
}

export function extractHeadlineCandidate(text = "") {
  if (typeof text !== "string") return "";

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);

  for (const line of lines) {
    if (line.length < 8 || line.length > 120) continue;
    if (line.includes("@") || EDUCATION_KEYWORDS.test(line)) continue;
    if (/curriculum vitae|resume/i.test(line)) continue;
    if (ROLE_KEYWORDS.test(line)) return line;
  }

  return "";
}

export function extractProjectCandidates(text = "") {
  if (typeof text !== "string" || !text.trim()) return [];

  const lines = text.split(/\r?\n/);
  const block = sectionLines(lines, /^(projects?|personal projects|academic projects|selected projects)\b/i);

  // Fallback: inline "Project: Name - description" lines.
  const inline = [];
  if (block.length === 0) {
    for (const line of lines) {
      const match = line
        .trim()
        .match(/^project\s*[:\-–]\s*(.{3,160})$/i);
      if (match) inline.push(match[1].trim());
    }
    return inline.slice(0, 6).map((name) => ({
      name,
      description: "",
      technologies: extractSkills(name).slice(0, 10),
      accomplishments: [],
    }));
  }

  const projects = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    if (current.name) {
      current.description = current.description.slice(0, 600).trim();
      current.technologies = extractSkills(
        `${current.name} ${current.description} ${current.accomplishments.join(" ")}`
      ).slice(0, 10);
      projects.push(current);
    }
    current = null;
  };

  for (const rawLine of block) {
    const line = rawLine.trim();
    if (!line) continue;

    if (BULLET_PATTERN.test(line)) {
      const accomplishment = line.replace(BULLET_PATTERN, "").trim();
      if (current && accomplishment) {
        current.accomplishments.push(accomplishment.slice(0, 300));
      }
      continue;
    }

    // A project name is short and title-like. Sentences become descriptions.
    const looksLikeName =
      !current ||
      (line.length <= 90 &&
        !/[.!?]$/.test(line) &&
        line.split(/\s+/).length <= 8);

    if (looksLikeName) {
      flush();
      current = { name: line.slice(0, 200), description: "", accomplishments: [] };
    } else if (current) {
      current.description = `${current.description} ${line}`.trim();
    }
  }
  flush();

  return uniqueBy(projects, (project) => project.name)
    .slice(0, 6)
    .map((project) => ({
      name: project.name,
      description: project.description,
      technologies: project.technologies,
      accomplishments: project.accomplishments.slice(0, 5),
    }));
}

export function extractCertificationCandidates(text = "") {
  if (typeof text !== "string" || !text.trim()) return [];

  const lines = text.split(/\r?\n/);
  const block = sectionLines(lines, /^(certifications?|certificates?)\b/i);
  const candidates = block.length ? block : lines.map((line) => line.trim());

  const certifications = [];
  for (const rawLine of candidates) {
    const line = rawLine.replace(BULLET_PATTERN, "").trim();
    if (line.length < 8 || line.length > 200) continue;
    if (!CERTIFICATION_KEYWORDS.test(line)) continue;
    if (EDUCATION_KEYWORDS.test(line) && !/certif|coursera|udemy|nptel/i.test(line)) {
      continue;
    }

    const issuer =
      [
        "Coursera",
        "Udemy",
        "NPTEL",
        "edX",
        "AWS",
        "Amazon Web Services",
        "Google",
        "Microsoft",
        "Meta",
        "Scrum Alliance",
        "PMI",
      ].find((name) => new RegExp(`\\b${name}\\b`, "i").test(line)) || "";
    const issueDate = line.match(/(19|20)\d{2}/)?.[0] || "";

    certifications.push({
      name: line.slice(0, 200),
      issuer,
      issueDate,
    });
  }

  return uniqueBy(certifications, (entry) => entry.name).slice(0, 6);
}

export function extractAchievementCandidates(text = "") {
  if (typeof text !== "string" || !text.trim()) return [];

  const lines = text.split(/\r?\n/);
  const block = sectionLines(lines, /^(achievements?|awards?|honors?)\b/i);
  const candidates = block.length ? block : lines.map((line) => line.trim());

  const achievements = [];
  for (const rawLine of candidates) {
    const line = rawLine.replace(BULLET_PATTERN, "").trim();
    if (line.length < 8 || line.length > 200) continue;
    if (!ACHIEVEMENT_KEYWORDS.test(line)) continue;
    achievements.push(line);
  }

  return uniqueBy(achievements, (entry) => entry).slice(0, 6);
}

export function buildExtractionProposals(text = "") {
  return {
    contact: extractContactInfo(text),
    headline: extractHeadlineCandidate(text),
    skills: extractSkills(text),
    projects: extractProjectCandidates(text),
    certifications: extractCertificationCandidates(text),
    achievements: extractAchievementCandidates(text),
  };
}

function scalarField(label, current, proposed) {
  const existing = String(current || "").trim();
  const candidate = String(proposed || "").trim();

  let status = "unavailable";
  if (candidate) {
    if (!existing) status = "new";
    else if (existing.toLowerCase() === candidate.toLowerCase()) status = "same";
    else status = "conflict";
  }

  return { field: label, label, current: existing, proposed: candidate, status };
}

/**
 * Builds a review view comparing extracted resume data with the stored profile.
 * Nothing is written here: the caller decides what to apply.
 */
export function buildExtractionReview({ resume, profile = {} }) {
  const proposals = buildExtractionProposals(resume?.text || "");
  const currentSkills = profile.skills || [];
  const currentLower = new Set(currentSkills.map((skill) => skill.toLowerCase()));
  const skillAdditions = proposals.skills.filter(
    (skill) => !currentLower.has(skill.toLowerCase())
  );

  const fields = [
    scalarField("headline", profile.headline, proposals.headline),
    scalarField("phone", profile.phone, proposals.contact.phone),
    scalarField("linkedinUrl", profile.linkedinUrl, proposals.contact.linkedinUrl),
    scalarField("githubUrl", profile.githubUrl, proposals.contact.githubUrl),
    scalarField("portfolioUrl", profile.portfolioUrl, proposals.contact.portfolioUrl),
  ];

  const conflicts = fields.filter((field) => field.status === "conflict");
  const newEntries = {
    projects: proposals.projects.filter(
      (project) =>
        !(profile.projects || []).some(
          (existing) =>
            existing.name?.toLowerCase() === project.name.toLowerCase()
        )
    ).length,
    certifications: proposals.certifications.filter(
      (entry) =>
        !(profile.certifications || []).some(
          (existing) =>
            existing.name?.toLowerCase() === entry.name.toLowerCase()
        )
    ).length,
    achievements: proposals.achievements.filter(
      (entry) =>
        !(profile.achievements || []).some(
          (existing) =>
            existing.title?.toLowerCase() === entry.toLowerCase()
        )
    ).length,
    skills: skillAdditions.length,
  };

  return {
    resume: {
      id: resume?.id || null,
      originalName: resume?.originalName || "",
      uploadedAt: resume?.uploadedAt || null,
      wordCount: resume?.parsed?.wordCount || 0,
    },
    proposals,
    comparison: {
      fields,
      skills: {
        current: currentSkills,
        proposed: proposals.skills,
        additions: skillAdditions,
      },
      newEntries,
    },
    conflicts,
    notes: [
      "Extraction is heuristic and can be wrong. Edit every value you keep.",
      "Existing profile values are only replaced when you explicitly allow overwriting.",
      "Unapproved answer-bank entries and unticked accomplishments are never treated as verified.",
    ],
  };
}
