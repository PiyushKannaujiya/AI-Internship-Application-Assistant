// Canonical names mapped to accepted aliases. Matching is case-insensitive and
// boundary-aware so "react" does not match "reactive".
const SKILL_ALIASES = {
  JavaScript: ["javascript", "ecmascript"],
  TypeScript: ["typescript"],
  Python: ["python"],
  Java: ["java"],
  "C++": ["c++", "cpp"],
  "C#": ["c#", "csharp"],
  Go: ["golang"],
  Rust: ["rust"],
  Kotlin: ["kotlin"],
  Swift: ["swift"],
  PHP: ["php"],
  Ruby: ["ruby"],
  SQL: ["sql"],
  HTML: ["html", "html5"],
  CSS: ["css", "css3"],
  React: ["react", "react.js", "reactjs"],
  "Next.js": ["next.js", "nextjs"],
  "React Native": ["react native"],
  Vue: ["vue", "vue.js", "vuejs"],
  Angular: ["angular", "angularjs"],
  "Node.js": ["node.js", "nodejs"],
  Express: ["express", "express.js", "expressjs"],
  Django: ["django"],
  Flask: ["flask"],
  FastAPI: ["fastapi"],
  Spring: ["spring boot", "springboot"],
  "REST APIs": ["rest api", "restful", "rest apis"],
  GraphQL: ["graphql"],
  gRPC: ["grpc"],
  MongoDB: ["mongodb", "mongo db", "mongo"],
  Mongoose: ["mongoose"],
  PostgreSQL: ["postgresql", "postgres"],
  MySQL: ["mysql"],
  SQLite: ["sqlite"],
  Redis: ["redis"],
  Docker: ["docker"],
  Kubernetes: ["kubernetes", "k8s"],
  AWS: ["aws", "amazon web services"],
  Azure: ["azure"],
  GCP: ["gcp", "google cloud"],
  Firebase: ["firebase"],
  Git: ["git"],
  GitHub: ["github"],
  Linux: ["linux"],
  Jest: ["jest"],
  Vitest: ["vitest"],
  Mocha: ["mocha"],
  Playwright: ["playwright"],
  Cypress: ["cypress"],
  Selenium: ["selenium"],
  Postman: ["postman"],
  Pandas: ["pandas"],
  NumPy: ["numpy"],
  "scikit-learn": ["scikit-learn", "sklearn"],
  TensorFlow: ["tensorflow"],
  PyTorch: ["pytorch"],
  "Machine Learning": ["machine learning", "ml models", "ml"],
  "Deep Learning": ["deep learning"],
  NLP: ["natural language processing", "nlp"],
  "Data Analysis": ["data analysis", "data analytics"],
  Tableau: ["tableau"],
  PowerBI: ["power bi", "powerbi"],
  Excel: ["excel"],
  Figma: ["figma"],
  Jira: ["jira"],
  Agile: ["agile"],
  Scrum: ["scrum"],
  "Problem Solving": ["problem solving", "problem-solving"],
  Communication: ["communication"],
  Leadership: ["leadership"],
  Teamwork: ["teamwork", "team work"],
  Testing: ["unit testing", "integration testing", "test automation"],
};

const ALIAS_TO_CANONICAL = new Map();
for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL.set(alias.toLowerCase(), canonical);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PATTERNS = [...ALIAS_TO_CANONICAL.keys()]
  .sort((a, b) => b.length - a.length)
  .map((alias) => ({
    canonical: ALIAS_TO_CANONICAL.get(alias),
    regex: new RegExp(
      `(?<![a-z0-9])${escapeRegex(alias)}(?![a-z0-9])`,
      "i"
    ),
  }));

export function extractSkills(text = "") {
  if (typeof text !== "string" || !text.trim()) return [];

  const found = new Set();
  for (const { canonical, regex } of PATTERNS) {
    if (regex.test(text)) found.add(canonical);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

export function canonicalSkill(skill = "") {
  const normalized = String(skill).trim().toLowerCase();
  return ALIAS_TO_CANONICAL.get(normalized) || String(skill).trim();
}

export function normalizeSkills(skills = []) {
  const found = new Set();
  for (const skill of skills) {
    if (typeof skill === "string" && skill.trim()) {
      found.add(canonicalSkill(skill));
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

export function extractExperienceYears(text = "") {
  if (typeof text !== "string") return 0;

  let years = 0;

  for (const match of text.matchAll(/(\d{1,2})\+?\s*(?:years?|yrs?)\b/gi)) {
    years = Math.max(years, Number(match[1]));
  }

  // Calculate spans like "2021 - 2024" or "Jan 2022 - Present".
  const currentYear = new Date().getUTCFullYear();
  for (const match of text.matchAll(
    /(?:19|20)\d{2}\s*(?:-|–|—|to)\s*((?:19|20)\d{2}|present|current)/gi
  )) {
    const start = Number(match[0].slice(0, 4));
    const endToken = match[1].toLowerCase();
    const end = ["present", "current"].includes(endToken)
      ? currentYear
      : Number(endToken);
    if (start <= end && end - start <= 40) {
      years = Math.max(years, end - start);
    }
  }

  return Math.min(40, years);
}

export function extractEducationMentions(text = "") {
  if (typeof text !== "string") return [];

  const educationKeywords =
    /(university|college|institute|bachelor|master|b\.?tech|m\.?tech|b\.?sc|m\.?sc|bca|mca|mba|ph\.?d|diploma)/i;

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && line.length <= 220)
    .filter((line) => educationKeywords.test(line))
    .slice(0, 6);
}
