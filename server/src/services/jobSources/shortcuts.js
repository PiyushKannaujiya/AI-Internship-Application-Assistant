// Platform search shortcuts for job boards that do not expose a permitted
// public search API for third-party listing discovery.
//
// What these are NOT: scraping, sign-in automation, CAPTCHA bypassing, private
// endpoints, or any claim that the platform is integrated through an API.
//
// What these ARE: a prefilled search that opens on the platform itself in the
// user's own browser. Each URL shape below was probed with a live request;
// details are recorded in docs/VERIFICATION.md. Discovering Internshala's
// keyword search, for example, is a form POST, so the Internshala shortcut
// opens its listing pages (remote/city/keyword categories) instead of faking a
// keyword query string it does not support.
//
// Shortcut sources never return listings: discovery responses carry them in a
// separate `shortcuts` array, and the UI labels them as platform search
// shortcuts, foreign to the live integrated sources.

const MAX_KEYWORDS = 100;

function cleanKeyword(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, MAX_KEYWORDS);
}

function slug(value, max = 60) {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text.slice(0, max).replace(/-+$/g, "");
}

const CITY_SLUGS = {
  // Verified against the real href set on internshala.com/internships.
  bengaluru: "bangalore",
  bangalore: "bangalore",
  mumbai: "mumbai",
  delhi: "delhi",
  ncr: "delhi",
  hyderabad: "hyderabad",
  chennai: "chennai",
  pune: "pune",
  kolkata: "kolkata",
  calcutta: "kolkata",
  jaipur: "jaipur",
};

export const PLATFORM_SEARCH_SHORTCUTS = [
  {
    id: "linkedin",
    label: "LinkedIn Jobs",
    base: "https://www.linkedin.com/",
    automaticIntegration: false,
    note:
      "LinkedIn has no public job-search API for third-party applications. This opens a guest login-free LinkedIn jobs search with your keyword; the internship and remote filters use LinkedIn's own URL parameters.",
    build({ search, location, jobType, remote }) {
      const params = new URLSearchParams();
      const keyword = cleanKeyword(search);
      if (keyword) params.set("keywords", keyword);
      params.set("location", cleanKeyword(location || "India") || "India");

      const JOB_TYPE_CODES = {
        internship: "I",
        "full-time": "F",
        "part-time": "P",
        contract: "C",
        temporary: "T",
      };
      const jobTypeCode = JOB_TYPE_CODES[jobType];
      if (jobTypeCode) params.set("f_JT", jobTypeCode);
      if (remote === true) params.set("f_WT", "2");

      return `https://www.linkedin.com/jobs/search/?${params
        .toString()
        .replace(/\+/g, "%20")}`;
    },
  },
  {
    id: "internshala",
    label: "Internshala",
    base: "https://internshala.com/",
    automaticIntegration: false,
    note:
      "Internshala has no public API and its keyword search is a form POST, so no honest keyword query URL exists. This opens the equivalents this platform does support: the remote listing section or the verified city listing page. Use the search box on the page for keywords.",
    build({ location, jobType, remote }) {
      // Remote flag wins: it is a verified listing section.
      if (remote === true) {
        return "https://internshala.com/internships/work-from-home-internships/";
      }
      const query = String(location || "").toLowerCase();
      if (jobType && jobType !== "internship") {
        // Job listing section rather than internships.
        return "https://internshala.com/jobs/";
      }
      if (query) {
        const terms = query.split(/[^a-z]+/).filter(Boolean);
        const city = terms.find((term) => CITY_SLUGS[term]);
        if (city) {
          return `https://internshala.com/internships/internship-in-${CITY_SLUGS[city]}/`;
        }
      }
      return "https://internshala.com/internships/";
    },
  },
  {
    id: "naukri",
    label: "Naukri",
    base: "https://www.naukri.com/",
    automaticIntegration: false,
    note:
      "Naukri has no public search API for job reading. This opens Naukri's own keyword search page for your terms.",
    build({ search, jobType }) {
      const keyword = slug(search, 80);
      const suffix = jobType === "internship" ? "internship-jobs" : "jobs";
      const base = "https://www.naukri.com/";
      if (!keyword) return base;
      return `${base}${keyword}-${suffix}`;
    },
  },
  {
    id: "wellfound",
    label: "Wellfound",
    base: "https://wellfound.com/jobs",
    automaticIntegration: false,
    note:
      "Wellfound exposes no public job-search API. This opens the Wellfound job list with your keyword pre-typed; refine location in the platform UI.",
    build({ search }) {
      const keyword = cleanKeyword(search);
      if (!keyword) return "https://wellfound.com/jobs";
      return `https://wellfound.com/jobs?query=${encodeURIComponent(keyword)}`;
    },
  },
  {
    id: "unstop",
    label: "Unstop",
    base: "https://unstop.com/internships",
    automaticIntegration: false,
    note:
      "Unstop exposes no public search API for third parties. This opens the Unstop internship listing with your keyword.",
    build({ search }) {
      const keyword = cleanKeyword(search);
      const base = "https://unstop.com/internships";
      if (!keyword) return base;
      return `${base}?search=${encodeURIComponent(keyword)}`;
    },
  },
  {
    id: "cutshort",
    label: "Cutshort",
    base: "https://cutshort.io/jobs",
    automaticIntegration: false,
    note:
      "Cutshort exposes no public search API for third parties. This opens the Cutshort job list with your keyword.",
    build({ search }) {
      const keyword = cleanKeyword(search);
      if (!keyword) return "https://cutshort.io/jobs";
      return `https://cutshort.io/jobs?query=${encodeURIComponent(keyword)}`;
    },
  },
  {
    id: "foundit",
    label: "Foundit",
    base: "https://www.foundit.in/srp/results",
    automaticIntegration: false,
    note:
      "Foundit (Monster India) exposes no public search API. This opens the Foundit results page with your keyword; the internship variant uses Foundit's verified job-type path.",
    build({ search, jobType }) {
      const keyword = cleanKeyword(search);
      if (!keyword) return "https://www.foundit.in/srp/results?query=";
      const segment =
        jobType === "internship" ? "/jobtype/internship" : "";
      return `https://www.foundit.in/srp/results?query=${encodeURIComponent(
        keyword
      )}${segment}`;
    },
  },
];

const SHORTCUTS_BY_ID = new Map(
  PLATFORM_SEARCH_SHORTCUTS.map((platform) => [platform.id, platform])
);

/**
 * Build one shortcut entry per supported platform for the current search.
 * Used by discovery so users always have a compliant way to search a platform
 * that does not allow live listing integration.
 */
export function listSearchShortcuts(params = {}) {
  return PLATFORM_SEARCH_SHORTCUTS.map((platform) => ({
    id: platform.id,
    label: platform.label,
    kind: "search-shortcut",
    automaticIntegration: platform.automaticIntegration,
    url: platform.build(params),
    note: platform.note,
  }));
}

export function getSearchShortcut(id) {
  return SHORTCUTS_BY_ID.get(id) || null;
}
