/**
 * Portal adapters for the local, human-supervised autofill helper.
 *
 * Each adapter describes a small set of stable selectors for a supported
 * applicant tracking system. Adapters never describe a submission control:
 * the helper refuses to click anything and leaves the page open for the user.
 */

export const FIELD_LABELS = Object.freeze({
  fullName: "Full name",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  linkedinUrl: "LinkedIn URL",
  githubUrl: "GitHub URL",
  portfolioUrl: "Portfolio URL",
  headline: "Headline",
  currentTitle: "Current title",
  currentCompany: "Current company",
  skills: "Skills",
  summary: "Summary",
  latestSchool: "School",
  latestDegree: "Degree",
  latestField: "Field of study",
  latestGraduationYear: "Graduation year",
  workAuthorization: "Work authorization",
  requiresSponsorship: "Requires sponsorship",
  coverLetter: "Cover letter",
});

const COMMON_FIELDS = [
  {
    canonical: "firstName",
    selectors: ["#first_name", 'input[name="job_application[first_name]"]'],
  },
  {
    canonical: "lastName",
    selectors: ["#last_name", 'input[name="job_application[last_name]"]'],
  },
  {
    canonical: "email",
    selectors: ["#email", 'input[type="email"]'],
  },
  {
    canonical: "phone",
    selectors: ["#phone", 'input[type="tel"]'],
  },
  {
    canonical: "linkedinUrl",
    selectors: [
      'input[name="job_application[urls][LinkedIn]"]',
      'input[name*="linkedin" i]',
    ],
    // Greenhouse boards often use a custom question instead of a named field.
    labels: ["LinkedIn URL", "LinkedIn Profile", "LinkedIn Profile Link"],
  },
  {
    canonical: "githubUrl",
    selectors: [
      'input[name="job_application[urls][GitHub]"]',
      'input[name*="github" i]',
    ],
  },
  {
    canonical: "portfolioUrl",
    selectors: [
      'input[name="job_application[website]"]',
      'input[name*="portfolio" i]',
      'input[name*="website" i]',
    ],
    labels: ["Portfolio URL", "Portfolio link", "Website"],
  },
  {
    canonical: "currentTitle",
    selectors: ['input[name*="job_title" i]', 'input[name*="current_title" i]'],
    labels: ["Current title", "Job title"],
  },
  {
    canonical: "skills",
    selectors: [
      'input[name*="skills" i]',
      'textarea[name*="skills" i]',
    ],
    labels: ["Skills"],
  },
  {
    canonical: "latestSchool",
    selectors: [
      'input[name*="school" i]',
      'input[name*="institution" i]',
      'input[name*="university" i]',
    ],
    labels: ["School", "University", "Institution"],
  },
  {
    canonical: "latestDegree",
    selectors: ['input[name*="degree" i]', 'select[name*="degree" i]'],
    labels: ["Degree", "Education"],
  },
  {
    canonical: "latestField",
    selectors: [
      'input[name*="discipline" i]',
      'input[name*="field_of_study" i]',
      'input[name*="major" i]',
    ],
    labels: ["Field of study", "Major", "Discipline"],
  },
  {
    canonical: "latestGraduationYear",
    selectors: [
      'input[name*="graduation" i]',
      'input[name*="grad_year" i]',
      'input[name*="end_year" i]',
    ],
    labels: ["Graduation year", "Graduation Year", "End year"],
  },
];

const GREENHOUSE = {
  key: "greenhouse",
  name: "Greenhouse",
  supported: true,
  autofillSupported: true,
  resumeUploadSupported: true,
  requiresLogin: false,
  hosts: ["greenhouse.io", "boards.greenhouse.io", "job-boards.greenhouse.io"],
  notes:
    "Greenhouse job boards render a single public application form. The helper fills it in the browser and leaves the Submit application button untouched.",
  limitations: [
    "Custom demographic and EEO questions vary per board and are left for you.",
    "Some boards hide the form behind an Apply button; open the form yourself first.",
  ],
  fields: [
    ...COMMON_FIELDS,
    {
      canonical: "location",
      selectors: ['input[name="job_application[location]"]', "#candidate-location"],
      labels: ["Location (City)", "Location", "City"],
    },
    {
      canonical: "currentCompany",
      selectors: ['input[name="job_application[current_company]"]'],
      labels: ["Current company", "Company"],
    },
  ],
  resumeSelectors: [
    'input[type="file"][name="job_application[resume]"]',
    'input[type="file"][id="resume"]',
  ],
  coverLetterSelectors: [
    'textarea[name="job_application[cover_letter]"]',
    'textarea[name*="cover_letter" i]',
    'textarea[id*="cover" i]',
  ],
  answerSelectors: ["textarea", 'input[type="text"]'],
};

const LEVER = {
  key: "lever",
  name: "Lever",
  supported: true,
  autofillSupported: true,
  resumeUploadSupported: true,
  requiresLogin: false,
  hosts: ["lever.co", "jobs.lever.co"],
  notes:
    "Lever application pages use a single form with stable name attributes. The helper fills text fields and attaches the approved resume.",
  limitations: [
    "The custom questions block uses per-posting labels; only saved approved answers whose wording matches are filled.",
    "File-based cover letter uploads are reported as unsupported and left for you.",
  ],
  fields: [
    {
      canonical: "fullName",
      selectors: ['input[name="name"]'],
      labels: ["Full name", "Name"],
    },
    {
      canonical: "email",
      selectors: ['input[name="email"]', 'input[type="email"]'],
      labels: ["Email"],
    },
    {
      canonical: "phone",
      selectors: ['input[name="phone"]', 'input[type="tel"]'],
      labels: ["Phone"],
    },
    {
      canonical: "currentCompany",
      selectors: ['input[name="org"]'],
      labels: ["Current company", "Company"],
    },
    {
      canonical: "linkedinUrl",
      selectors: ['input[name="urls[LinkedIn]"]', 'input[name*="linkedin" i]'],
      labels: ["LinkedIn URL", "LinkedIn Profile"],
    },
    {
      canonical: "githubUrl",
      selectors: ['input[name="urls[GitHub]"]', 'input[name*="github" i]'],
      labels: ["GitHub URL", "Github Link"],
    },
    {
      canonical: "portfolioUrl",
      selectors: ['input[name="urls[Portfolio]"]', 'input[name*="portfolio" i]'],
      labels: ["Portfolio URL", "Portfolio"],
    },
    {
      canonical: "location",
      selectors: ['input[name="location"]'],
      labels: ["Current location", "Location"],
    },
    {
      canonical: "skills",
      selectors: ['input[name*="skills" i]', 'textarea[name*="skills" i]'],
      labels: ["Skills"],
    },
    {
      canonical: "latestSchool",
      selectors: ['input[name*="school" i]', 'input[name*="institution" i]'],
      labels: ["School", "Institution"],
    },
    {
      canonical: "latestDegree",
      selectors: ['input[name*="degree" i]'],
      labels: ["Degree"],
    },
    {
      canonical: "latestField",
      selectors: ['input[name*="discipline" i]', 'input[name*="major" i]'],
      labels: ["Field of study", "Major", "Discipline"],
    },
    {
      canonical: "latestGraduationYear",
      selectors: ['input[name*="graduation" i]', 'input[name*="end_year" i]'],
      labels: ["Graduation year", "End year"],
    },
  ],
  resumeSelectors: [
    'input[type="file"][name="resume"]',
    'input[type="file"][id="resume-upload-input"]',
  ],
  coverLetterSelectors: [
    'textarea[name="comments"]',
    'textarea[name*="cover" i]',
    'textarea[id*="cover" i]',
  ],
  answerSelectors: ["textarea", 'input[type="text"]'],
};

const ASHBY = {
  key: "ashby",
  name: "Ashby",
  supported: true,
  autofillSupported: true,
  resumeUploadSupported: true,
  requiresLogin: false,
  hosts: ["ashbyhq.com", "jobs.ashbyhq.com"],
  notes:
    "Ashby renders a React form. The helper uses system-field names plus visible labels, and reports any field it cannot resolve instead of guessing.",
  limitations: [
    "Ashby's custom questions and dropdowns change per posting; unmatched questions are reported.",
    "Autosave may reformat values after typing; the helper re-reads each field and reports mismatches.",
  ],
  fields: [
    {
      canonical: "fullName",
      selectors: ['input[name="_systemfield_name"]', 'input[name*="name" i]'],
      labels: ["Full Name", "Name"],
    },
    {
      canonical: "email",
      selectors: ['input[name="_systemfield_email"]', 'input[type="email"]'],
      labels: ["Email"],
    },
    {
      canonical: "phone",
      selectors: ['input[name="_systemfield_phone"]', 'input[type="tel"]'],
      labels: ["Phone"],
    },
    {
      canonical: "location",
      selectors: ['input[name="_systemfield_location"]', 'input[name*="location" i]'],
      labels: ["Current Location", "Location"],
    },
    {
      canonical: "linkedinUrl",
      selectors: ['input[name="_systemfield_linkedin"]', 'input[name*="linkedin" i]'],
      labels: ["LinkedIn Profile", "LinkedIn URL"],
    },
    {
      canonical: "githubUrl",
      selectors: ['input[name*="github" i]'],
      labels: ["Github Link", "GitHub URL"],
    },
    {
      canonical: "portfolioUrl",
      selectors: ['input[name*="portfolio" i]', 'input[name*="website" i]'],
      labels: ["Portfolio URL", "Portfolio"],
    },
    {
      canonical: "skills",
      selectors: ['input[name*="skills" i]', 'textarea[name*="skills" i]'],
      labels: ["Skills"],
    },
    {
      canonical: "latestSchool",
      selectors: ['input[name*="school" i]', 'input[name*="institution" i]'],
      labels: ["School", "Institution"],
    },
    {
      canonical: "latestDegree",
      selectors: ['input[name*="degree" i]', 'input[name*="education" i]'],
      labels: ["Degree", "Education"],
    },
    {
      canonical: "latestGraduationYear",
      selectors: ['input[name*="graduation" i]', 'input[name*="end_year" i]'],
      labels: ["Graduation year", "End year"],
    },
  ],
  // Ashby has two file inputs: a top "Autofill from resume" helper and the
  // actual resume field. Target the system field first so the approved PDF is
  // never attached to the parser helper.
  resumeSelectors: [
    'input[type="file"][id="_systemfield_resume"]',
    'input[type="file"][name="_systemfield_resume"]',
    'input[type="file"]',
  ],
  coverLetterSelectors: ['textarea[name*="cover" i]', 'textarea[placeholder*="cover" i]'],
  answerSelectors: ["textarea", 'input[type="text"]'],
};

const LINKEDIN = {
  key: "linkedin",
  name: "LinkedIn Easy Apply",
  supported: false,
  autofillSupported: false,
  resumeUploadSupported: false,
  requiresLogin: true,
  hosts: ["linkedin.com"],
  unsupportedReason:
    "LinkedIn requires a signed-in session and its terms do not permit automated form filling.",
  notes:
    "Open the posting yourself and use the manual fallback: every verified value is available in the application preview.",
  limitations: [
    "No login, cookie, or session handling is implemented.",
    "LinkedIn's anti-automation controls are never bypassed.",
  ],
  fields: [],
  resumeSelectors: [],
  coverLetterSelectors: [],
  answerSelectors: [],
};

const WORKDAY = {
  key: "workday",
  name: "Workday",
  supported: false,
  autofillSupported: false,
  resumeUploadSupported: false,
  requiresLogin: true,
  hosts: ["myworkdayjobs.com", "workday.com", "wd1.myworkdayjobs.com"],
  unsupportedReason:
    "Workday requires account creation and a multi-page signed-in flow; the helper does not handle credentials.",
  notes:
    "Use the manual fallback and paste values from the application preview. Workday often parses an uploaded resume first.",
  limitations: [
    "Account-gated and multi-step forms are out of scope by design.",
    "Never enter passwords into the helper.",
  ],
  fields: [],
  resumeSelectors: [],
  coverLetterSelectors: [],
  answerSelectors: [],
};

const GENERIC = {
  key: "generic",
  name: "Unsupported portal (manual fallback)",
  supported: false,
  autofillSupported: false,
  resumeUploadSupported: false,
  requiresLogin: false,
  hosts: [],
  unsupportedReason:
    "No maintained adapter matches this application URL, so the helper will not guess at its form.",
  notes:
    "Open the application page yourself and copy the verified values from the application preview.",
  limitations: [
    "Only Greenhouse, Lever, and Ashby have maintained adapters.",
    "Unsupported forms stay manual; unsupported controls are never forced.",
  ],
  fields: [],
  resumeSelectors: [],
  coverLetterSelectors: [],
  answerSelectors: [],
};

export const ADAPTERS = [GREENHOUSE, LEVER, ASHBY, LINKEDIN, WORKDAY];

function hostMatches(hostname, hosts) {
  const host = String(hostname || "").toLowerCase();
  return hosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * Returns the first adapter whose host list matches the URL, otherwise the
 * generic manual-fallback descriptor.
 */
export function detectAdapter(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return { ...GENERIC, matchedHost: "", detected: false };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ...GENERIC, matchedHost: "", detected: false };
  }

  const adapter = ADAPTERS.find((entry) => hostMatches(parsed.hostname, entry.hosts));
  return adapter
    ? { ...adapter, matchedHost: parsed.hostname, detected: true }
    : {
        ...GENERIC,
        matchedHost: parsed.hostname,
        detected: false,
        unsupportedReason: `No maintained adapter matches ${parsed.hostname}.`,
      };
}

/**
 * Returns the public form URL for adapters whose saved listing URL is not the
 * form itself. Lever and Ashby job URLs are listing pages; their application
 * forms live at `/apply` and `/application`. Greenhouse job URLs already open
 * the form. Unsupported URLs are returned unchanged.
 */
export function applicationFormUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return url;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return url;

  const adapter = detectAdapter(parsed.toString());
  const path = parsed.pathname.replace(/\/+$/, "");

  if (adapter.key === "lever" && !/\/apply$/i.test(path)) {
    parsed.pathname = `${path}/apply`;
  } else if (adapter.key === "ashby" && !/\/application$/i.test(path)) {
    parsed.pathname = `${path}/application`;
  } else {
    return url;
  }

  return parsed.toString();
}

export function getAdapter(key) {
  return ADAPTERS.find((adapter) => adapter.key === key) || null;
}

export function listAdapters() {
  return [...ADAPTERS, GENERIC].map((adapter) => ({
    key: adapter.key,
    name: adapter.name,
    supported: adapter.supported,
    autofillSupported: adapter.autofillSupported,
    resumeUploadSupported: adapter.resumeUploadSupported,
    requiresLogin: adapter.requiresLogin,
    hosts: adapter.hosts,
    notes: adapter.notes,
    limitations: adapter.limitations,
    unsupportedReason: adapter.unsupportedReason || "",
    fieldCount: adapter.fields.length,
  }));
}

export function adapterSummary(adapter) {
  return {
    key: adapter.key,
    name: adapter.name,
    supported: Boolean(adapter.supported),
    autofillSupported: Boolean(adapter.autofillSupported),
    resumeUploadSupported: Boolean(adapter.resumeUploadSupported),
    requiresLogin: Boolean(adapter.requiresLogin),
    matchedHost: adapter.matchedHost || "",
    unsupportedReason: adapter.unsupportedReason || "",
    notes: adapter.notes || "",
    limitations: adapter.limitations || [],
  };
}
