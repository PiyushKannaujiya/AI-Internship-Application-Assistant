import test from "node:test";
import assert from "node:assert/strict";

// Configure the provider before importing the service so this file exercises
// the "configured but failing" path rather than the not-configured fallback.
process.env.NODE_ENV = "test";
process.env.AI_PROVIDER = "openai";
process.env.AI_API_KEY = "test-key-that-is-never-used";
process.env.AI_BASE_URL = "https://ai.invalid/v1";
process.env.AI_MODEL = "gpt-4o-mini";
process.env.AI_TIMEOUT_MS = "2000";

const { generateTailoredSummary, getAiStatus } = await import(
  "../src/services/ai.js"
);

const user = {
  name: "Asha Verma",
  email: "asha@example.com",
  profile: {
    headline: "Backend Engineering Intern",
    summary: "Node.js developer focused on APIs.",
    skills: ["JavaScript", "Node.js"],
    projects: [],
  },
};

const job = {
  title: "Backend Engineering Intern",
  company: "Acme Systems",
  location: "Remote",
  jobType: "internship",
  description: "Build REST APIs with Node.js.",
  skills: ["Node.js"],
};

const match = {
  score: 80,
  matchedSkills: ["Node.js"],
  missingSkills: [],
  experience: { userYears: 1, requiredYears: 0 },
  reasons: ["Relevant skills match."],
};

test("a failing AI provider falls back to the deterministic summary", async () => {
  assert.equal(getAiStatus().configured, true);

  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("network unavailable");
  };

  try {
    const result = await generateTailoredSummary({
      user,
      job,
      match,
      draftSummary: "Tailored for Backend Engineering Intern at Acme Systems.",
    });

    assert.equal(result.provider, "heuristic");
    assert.equal(
      result.summary,
      "Tailored for Backend Engineering Intern at Acme Systems."
    );
    assert.match(result.notice, /Provider issue: network_error/i);
  } finally {
    global.fetch = originalFetch;
  }
});
