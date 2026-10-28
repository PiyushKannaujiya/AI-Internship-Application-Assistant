// URL import: read a public job page and return a draft the user reviews.
//
// This is page extraction, not a platform integration. No job board is claimed
// as supported through an API here, and nothing signs in or bypasses a wall.

import { fetchJobPage } from "./pageFetch.js";
import { extractJobFromHtml } from "./extract.js";

export const MANUAL_IMPORT_FIELDS = [
  "title",
  "company",
  "description",
  "applicationUrl",
];

export const MANUAL_IMPORT_NOTE =
  "Automatic extraction was not possible. Paste the job title, company, description, and application URL, then save the job manually. This assistant never signs in, solves CAPTCHAs, or bypasses access controls for you.";

const UNKNOWN_PLATFORM = {
  id: "unknown",
  label: "Web page",
  note: "The page could not be read.",
  automaticIntegration: false,
};

function manualFallback({ finalUrl, requestedUrl, platform, notes, page }) {
  return {
    required: MANUAL_IMPORT_FIELDS,
    prefill: {
      title: page?.title || "",
      company: page?.siteName || "",
      description: "",
      applicationUrl: finalUrl || requestedUrl,
      location: "",
      jobType: "internship",
      remote: false,
    },
    note: MANUAL_IMPORT_NOTE,
    ...(notes?.length ? { notes } : {}),
    ...(platform ? { platform } : {}),
  };
}

export async function importJobFromUrl(rawUrl, options = {}) {
  const requestedUrl = String(rawUrl).trim();
  const fetched = await fetchJobPage(requestedUrl, options);
  const finalUrl = fetched.finalUrl;

  const readable =
    fetched.status >= 200 && fetched.status < 400 && Boolean(fetched.html);

  const extracted = readable
    ? extractJobFromHtml(fetched.html, { url: finalUrl })
    : null;

  const platform = extracted?.platform ?? UNKNOWN_PLATFORM;

  const base = {
    requestedUrl,
    finalUrl,
    platform,
    automaticIntegration: false,
  };

  if (!readable) {
    const blockedStatus = [401, 403, 429].includes(fetched.status);
    const notes = [
      blockedStatus
        ? `The site answered HTTP ${fetched.status}. This assistant does not bypass access controls or rate limits.`
        : `The page returned HTTP ${fetched.status} and no content could be read.`,
    ];

    return {
      ...base,
      extracted: false,
      strategy: null,
      confidence: null,
      notes,
      job: null,
      manualImport: manualFallback({
        requestedUrl,
        finalUrl,
        platform,
        notes,
      }),
    };
  }

  if (!extracted.job) {
    return {
      ...base,
      extracted: false,
      strategy: extracted.strategy,
      confidence: extracted.confidence,
      notes: extracted.notes,
      job: null,
      manualImport: manualFallback({
        requestedUrl,
        finalUrl,
        platform,
        notes: extracted.notes,
        page: extracted.page,
      }),
    };
  }

  return {
    ...base,
    extracted: true,
    strategy: extracted.strategy,
    confidence: extracted.confidence,
    notes: extracted.notes,
    job: extracted.job,
    manualImport: null,
  };
}
