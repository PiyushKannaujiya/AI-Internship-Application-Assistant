export const SOURCE_LABELS = {
  manual: "Manual",
  remotive: "Remotive",
  jobicy: "Jobicy",
  arbeitnow: "Arbeitnow",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  remoteok: "Remote OK",
  adzuna: "Adzuna",
  workable: "Workable",
  smartrecruiters: "SmartRecruiters",
  url: "Imported URL",
};

export function sourceLabel(source) {
  return SOURCE_LABELS[source] || "Manual";
}

// Kept in sync with server/src/services/jobSources. Sources that need a company
// identifier cannot be queried without one, so the UI asks for it explicitly.
export const DISCOVERABLE_SOURCES = [
  { name: "remotive", label: "Remotive", requiresTarget: false },
  {
    name: "adzuna",
    label: "Adzuna (India)",
    requiresTarget: false,
    requiresKey: true,
    keyHint: "Needs free API keys: ADZUNA_APP_ID / ADZUNA_APP_KEY",
  },
  { name: "jobicy", label: "Jobicy", requiresTarget: false },
  { name: "arbeitnow", label: "Arbeitnow", requiresTarget: false },
  { name: "remoteok", label: "Remote OK", requiresTarget: false },
  {
    name: "workable",
    label: "Workable",
    requiresTarget: true,
    targetPlaceholder: "Account names, e.g. mercari-india",
  },
  {
    name: "smartrecruiters",
    label: "SmartRecruiters",
    requiresTarget: true,
    targetPlaceholder: "Company ids, e.g. linkedin3, wnsglobalservices144",
  },
  {
    name: "greenhouse",
    label: "Greenhouse",
    requiresTarget: true,
    targetPlaceholder: "Board names, e.g. stripe, figma",
  },
  {
    name: "lever",
    label: "Lever",
    requiresTarget: true,
    targetPlaceholder: "Site names, e.g. spotify, figma",
  },
  {
    name: "ashby",
    label: "Ashby",
    requiresTarget: true,
    targetPlaceholder: "Organizations, e.g. notion, ramp",
  },
];

export const DEFAULT_DISCOVERY_SOURCES = [
  "smartrecruiters",
  "workable",
  "remotive",
  "jobicy",
  "arbeitnow",
];

// Platforms with no permitted public listing API. The backend returns these as
// prebuilt search shortcuts alongside live results; this list only labels the
// UI, so keep ids in sync with server/src/services/jobSources/shortcuts.js.
export const PLATFORM_SHORTCUT_ID = "search-shortcut";
