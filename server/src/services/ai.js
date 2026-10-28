import { z } from "zod";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";
import { summarizeMatchForPrompt } from "./matching.js";

class AiProviderError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = "AiProviderError";
    this.reason = reason;
  }
}

export function getAiStatus() {
  const configured = env.AI_PROVIDER === "openai" && Boolean(env.AI_API_KEY);
  return {
    configured,
    provider: configured ? "openai" : "template",
    model: configured ? env.AI_MODEL : null,
    fallback:
      "Template-based content is always available when AI is not configured.",
  };
}

async function callChatJson({ system, user, maxTokens = 1400 }) {
  if (!getAiStatus().configured) {
    throw new AiProviderError("AI provider is not configured", "not_configured");
  }

  const endpoint = `${env.AI_BASE_URL.replace(/\/+$/, "")}/chat/completions`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
    });
  } catch (error) {
    const reason =
      error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "timeout"
        : "network_error";
    throw new AiProviderError("AI provider request failed", reason);
  }

  if (response.status === 429) {
    throw new AiProviderError("AI provider rate limit exceeded", "rate_limited");
  }

  if (!response.ok) {
    throw new AiProviderError(
      `AI provider returned HTTP ${response.status}`,
      "provider_error"
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AiProviderError("AI provider returned invalid JSON", "invalid_response");
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AiProviderError("AI provider returned an empty response", "empty_response");
  }

  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new AiProviderError("AI provider returned unparseable content", "invalid_json");
  }
}

function profileFacts(user) {
  const profile = user.profile || {};
  return {
    name: user.name,
    headline: profile.headline || "",
    summary: profile.summary || "",
    location: profile.location || "",
    skills: (profile.skills || []).slice(0, 40),
    education: (profile.education || []).slice(0, 5),
    experience: (profile.experience || []).slice(0, 8),
    preferredRoles: (profile.preferredRoles || []).slice(0, 10),
  };
}

const SAFETY_RULES = `You are helping a candidate draft application content.
Use ONLY the facts supplied. Never invent employers, degrees, dates, metrics, certifications, or personal details.
If a detail is missing, write a clear placeholder like [ADD SPECIFIC EXAMPLE] instead of guessing.
Do not add discriminatory, misleading, or legally risky content. Keep the tone professional.
Return a single JSON object only, with no markdown fences.`;

function templateCoverLetter({ user, job, match, tone }) {
  const profile = user.profile || {};
  const matched = match.matchedSkills.slice(0, 6);
  const missing = match.missingSkills.slice(0, 3);
  const intro =
    profile.headline ||
    profile.summary ||
    "I am a candidate interested in building practical software.";
  const toneLine =
    tone === "enthusiastic"
      ? `I am genuinely excited about the ${job.title} opportunity at ${job.company}.`
      : tone === "concise"
        ? `I am applying for the ${job.title} role at ${job.company}.`
        : `I am writing to apply for the ${job.title} role at ${job.company}.`;

  const body = [
    "Dear Hiring Manager,",
    "",
    `${toneLine} ${intro}`,
    "",
    matched.length
      ? `My background includes ${matched.join(", ")}, which aligns with the skills highlighted in the posting.`
      : "I would welcome the chance to discuss how my background can contribute to your team.",
    profile.summary ? `\n${profile.summary}` : "",
    missing.length
      ? `\nI am also actively strengthening ${missing.join(", ")} and would be glad to share relevant project work.`
      : "",
    "\nI would appreciate the opportunity to discuss how I can contribute. Thank you for your time and consideration.",
    "",
    "Sincerely,",
    user.name,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    subject: `Application for ${job.title} at ${job.company}`,
    body,
    provider: "template",
    notice:
      "AI is not configured (or is temporarily unavailable). This is a deterministic template built from your verified profile data. Review and edit it before using it.",
  };
}

function fallbackSuggestions({ job, match, resume }) {
  const items = [...match.suggestions];
  items.push({
    title: "Match the posting's language",
    detail: `Use the same terms the posting uses for ${job.title}, but only where they accurately describe your experience.`,
  });
  if (!resume) {
    items.unshift({
      title: "Upload a resume first",
      detail: "Resume parsing drives skill detection and experience estimates.",
    });
  }
  return {
    summary: `For ${job.title} at ${job.company}, your explainable match is ${match.score}/100. Focus on ${match.matchedSkills.slice(0, 4).join(", ") || "your most relevant projects"} and address ${match.missingSkills.slice(0, 3).join(", ") || "any gaps honestly"}.`,
    suggestions: items.slice(0, 8),
    provider: "template",
    notice:
      "AI is not configured (or unavailable), so these suggestions come from the deterministic matching engine, not an AI model.",
  };
}

const coverLetterSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(50).max(10000),
});

const suggestionsSchema = z.object({
  summary: z.string().trim().min(10).max(1000),
  suggestions: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(160),
        detail: z.string().trim().min(10).max(1500),
      })
    )
    .min(1)
    .max(10),
});

const answersSchema = z.object({
  answers: z
    .array(
      z.object({
        question: z.string().trim().min(3).max(500),
        answer: z.string().trim().min(10).max(4000),
      })
    )
    .min(1)
    .max(10),
});

function generationContext({ user, resume, job, match }) {
  return `CANDIDATE PROFILE (verified data):
${JSON.stringify(profileFacts(user), null, 2)}

RESUME TEXT (may be incomplete; do not add facts):
${(resume?.text || "No resume uploaded").slice(0, 6000)}

JOB:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Type: ${job.jobType}
Description:
${(job.description || "").slice(0, 5000)}

MATCHING CONTEXT:
${summarizeMatchForPrompt(match)}`;
}

export async function generateCoverLetter({ user, resume, job, match, tone }) {
  const fallback = templateCoverLetter({ user, job, match, tone });

  if (!getAiStatus().configured) return fallback;

  try {
    const raw = await callChatJson({
      system: SAFETY_RULES,
      user: `${generationContext({ user, resume, job, match })}

Write a ${tone} cover letter for this job. Address it to "Dear Hiring Manager" unless a name is provided.
Return JSON exactly like: {"subject":"...","body":"..."}
Keep the body under 350 words.`,
    });

    const parsed = coverLetterSchema.parse(raw);
    return {
      ...parsed,
      provider: "openai",
      notice: "AI-generated draft. Review every claim before submitting.",
    };
  } catch (error) {
    logger.warn("ai_cover_letter_fallback", {
      reason: error?.reason || error?.name || "generation_failed",
    });
    return {
      ...fallback,
      notice: `${fallback.notice} Provider issue: ${error?.reason || "generation failed"}.`,
    };
  }
}

export async function generateResumeSuggestions({ user, resume, job, match }) {
  const fallback = fallbackSuggestions({ job, match, resume });

  if (!getAiStatus().configured) return fallback;

  try {
    const raw = await callChatJson({
      system: SAFETY_RULES,
      user: `${generationContext({ user, resume, job, match })}

Give tailored, concrete resume improvement suggestions for this specific job.
Return JSON exactly like:
{"summary":"...","suggestions":[{"title":"...","detail":"..."}]}
Provide 3-6 suggestions. Never tell the user to claim skills they do not have.`,
    });

    const parsed = suggestionsSchema.parse(raw);
    return {
      ...parsed,
      provider: "openai",
      notice: "AI-generated suggestions. Verify that every statement is accurate.",
    };
  } catch (error) {
    logger.warn("ai_resume_suggestions_fallback", {
      reason: error?.reason || error?.name || "generation_failed",
    });
    return {
      ...fallback,
      notice: `${fallback.notice} Provider issue: ${error?.reason || "generation failed"}.`,
    };
  }
}

export async function generateApplicationAnswers({
  user,
  resume,
  job,
  match,
  questions,
}) {
  const fallback = {
    answers: questions.map((question) => ({
      question,
      answer: `${
        user.profile?.summary ||
        user.profile?.headline ||
        "I am a candidate with relevant technical foundations."
      }\n\nRelevant experience: ${
        match.matchedSkills.slice(0, 5).join(", ") || "[ADD RELEVANT EXPERIENCE]"
      }.\n\n[ADD A SPECIFIC EXAMPLE that answers: "${question}"]`,
    })),
    provider: "template",
    notice:
      "AI is not configured (or unavailable). These are template answers built from your profile; replace all bracketed placeholders.",
  };

  if (!getAiStatus().configured) return fallback;

  try {
    const raw = await callChatJson({
      system: SAFETY_RULES,
      user: `${generationContext({ user, resume, job, match })}

Answer each application question using only verified profile/resume facts.
Questions:
${questions.map((question, index) => `${index + 1}. ${question}`).join("\n")}

Return JSON exactly like:
{"answers":[{"question":"...","answer":"..."}]}
Answer every question. Use [ADD SPECIFIC EXAMPLE] where a real example is needed.`,
    });

    const parsed = answersSchema.parse(raw);
    const byQuestion = new Map(
      parsed.answers.map((entry) => [entry.question.trim(), entry.answer])
    );
    const complete = questions.every((question) => byQuestion.has(question.trim()));

    if (!complete) {
      throw new AiProviderError("AI response omitted questions", "incomplete_response");
    }

    return {
      answers: questions.map((question) => ({
        question,
        answer: byQuestion.get(question.trim()),
      })),
      provider: "openai",
      notice: "AI-generated drafts. Review and edit before pasting anywhere.",
    };
  } catch (error) {
    logger.warn("ai_answers_fallback", {
      reason: error?.reason || error?.name || "generation_failed",
    });
    return {
      ...fallback,
      notice: `${fallback.notice} Provider issue: ${error?.reason || "generation failed"}.`,
    };
  }
}

const tailoredSummarySchema = z.object({
  summary: z.string().trim().min(20).max(900),
});

/**
 * Optionally rewrites the deterministic tailored summary. The prompt forbids
 * adding facts, and any provider problem falls back to the deterministic text.
 */
export async function generateTailoredSummary({
  user,
  job,
  match,
  draftSummary,
}) {
  const fallback = {
    summary: draftSummary,
    provider: "heuristic",
    model: "",
    notice:
      "This summary was built deterministically from your verified profile. Review it before approving.",
  };

  if (!getAiStatus().configured) return fallback;

  try {
    const raw = await callChatJson({
      system: SAFETY_RULES,
      user: `${generationContext({ user, resume: null, job, match })}

Rewrite the draft summary for this job. Use ONLY facts from the candidate profile above. Do not add employers, degrees, dates, metrics, certifications, or skills. Keep it under 120 words.

Draft summary:
${draftSummary}

Return JSON exactly like: {"summary":"..."}`,
      maxTokens: 500,
    });

    const parsed = tailoredSummarySchema.parse(raw);
    return {
      summary: parsed.summary,
      provider: "openai",
      model: env.AI_MODEL,
      notice:
        "AI-assisted summary. Verify every claim before approving this resume.",
    };
  } catch (error) {
    logger.warn("ai_tailored_summary_fallback", {
      reason: error?.reason || error?.name || "generation_failed",
    });
    return {
      ...fallback,
      notice: `${fallback.notice} Provider issue: ${
        error?.reason || "generation failed"
      }.`,
    };
  }
}

export function assertAiInputs(job, resume) {
  if (!job) throw ApiError.notFound("Job not found");
  if (!resume) {
    throw ApiError.unprocessable(
      "Upload a resume before generating tailored application content"
    );
  }
}
