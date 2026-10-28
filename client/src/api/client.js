const RAW_API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export const API_URL = RAW_API_URL.replace(/\/+$/, "");

const TOKEN_KEY = "applypilot.token";

export class ApiError extends Error {
  constructor(message, { status = 0, code = "NETWORK_ERROR", errors } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

export function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be unavailable in private modes; the session still works
    // until the page reloads.
  }
}

function queryString(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const output = search.toString();
  return output ? `?${output}` : "";
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return null;
}

async function request(path, { method = "GET", body, signal } = {}) {
  const token = getToken();
  const headers = { Accept: "application/json" };

  if (token) headers.Authorization = `Bearer ${token}`;

  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: payload,
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError(
      "Cannot reach the API. Check that the backend is running and VITE_API_URL is correct."
    );
  }

  const data = await parseResponse(response);

  if (!response.ok) {
    if (response.status === 401 && token) {
      window.dispatchEvent(new Event("applypilot:session-expired"));
    }

    throw new ApiError(
      data?.message || `Request failed with HTTP ${response.status}`,
      {
        status: response.status,
        code: data?.code || "REQUEST_FAILED",
        errors: data?.errors,
      }
    );
  }

  return data;
}

export const api = {
  auth: {
    register: (body) => request("/auth/register", { method: "POST", body }),
    login: (body) => request("/auth/login", { method: "POST", body }),
    me: () => request("/auth/me"),
    logout: () => request("/auth/logout", { method: "POST" }),
    changePassword: (body) =>
      request("/auth/change-password", { method: "POST", body }),
  },
  users: {
    getMe: () => request("/users/me"),
    update: (body) => request("/users/me", { method: "PATCH", body }),
  },
  resumes: {
    get: () => request("/resumes/me"),
    upload: (file) => {
      const form = new FormData();
      form.append("resume", file);
      return request("/resumes", { method: "POST", body: form });
    },
    remove: () => request("/resumes/me", { method: "DELETE" }),
    extraction: () => request("/resumes/me/extraction"),
    applyExtraction: (body) =>
      request("/resumes/me/extraction/apply", { method: "POST", body }),
    download: async () => {
      const token = getToken();
      const response = await fetch(`${API_URL}/resumes/me/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        throw new ApiError("Could not download the resume", {
          status: response.status,
        });
      }

      return response.blob();
    },
  },
  jobs: {
    list: (params) => request(`/jobs${queryString(params)}`),
    get: (id) => request(`/jobs/${id}`),
    create: (body) => request("/jobs", { method: "POST", body }),
    update: (id, body) => request(`/jobs/${id}`, { method: "PATCH", body }),
    remove: (id) => request(`/jobs/${id}`, { method: "DELETE" }),
    save: (id) => request(`/jobs/${id}/save`, { method: "POST" }),
    unsave: (id) => request(`/jobs/${id}/save`, { method: "DELETE" }),
    discover: ({
      search = "",
      location = "",
      remote = "",
      jobType = "",
      limit = 12,
      sources = "",
      greenhouse = "",
      lever = "",
      ashby = "",
      workable = "",
      smartrecruiters = "",
    } = {}) =>
      request(
        `/jobs/discover${queryString({
          search,
          location,
          remote,
          jobType,
          limit,
          sources,
          greenhouse,
          lever,
          ashby,
          workable,
          smartrecruiters,
        })}`
      ),
    import: (externalId, { source = "remotive", board } = {}) =>
      request("/jobs/import", {
        method: "POST",
        body: { externalId, source, ...(board ? { board } : {}) },
      }),
    importUrl: (url, { save = false } = {}) =>
      request("/jobs/import-url", {
        method: "POST",
        body: { url, save },
      }),
    match: (id) => request(`/jobs/${id}/match`, { method: "POST" }),
  },
  tailoredResumes: {
    list: (params) => request(`/tailored-resumes${queryString(params)}`),
    get: (id) => request(`/tailored-resumes/${id}`),
    create: (jobId) =>
      request("/tailored-resumes", { method: "POST", body: { jobId } }),
    update: (id, content) =>
      request(`/tailored-resumes/${id}`, { method: "PATCH", body: { content } }),
    approve: (id) =>
      request(`/tailored-resumes/${id}/approve`, {
        method: "POST",
        body: { approved: true },
      }),
    regenerate: (id) =>
      request(`/tailored-resumes/${id}/regenerate`, { method: "POST" }),
    download: async (id, format) => {
      const token = getToken();
      const response = await fetch(`${API_URL}/tailored-resumes/${id}/download/${format}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        throw new ApiError(`Could not download the ${format.toUpperCase()} version`, {
          status: response.status,
        });
      }

      return response.blob();
    },
  },
  applications: {
    list: (params) => request(`/applications${queryString(params)}`),
    create: (body) => request("/applications", { method: "POST", body }),
    update: (id, body) =>
      request(`/applications/${id}`, { method: "PATCH", body }),
    remove: (id) => request(`/applications/${id}`, { method: "DELETE" }),
    preview: (id) => request(`/applications/${id}/preview`),
    submit: (id, body) =>
      request(`/applications/${id}/submit`, { method: "POST", body }),
    readiness: (id) => request(`/applications/${id}/readiness`),
    evaluateReadiness: (id, requirements) =>
      request(`/applications/${id}/readiness`, {
        method: "POST",
        body: { requirements },
      }),
    autofillPlan: (id) => request(`/applications/${id}/autofill-plan`),
    autofillRuns: (id) => request(`/applications/${id}/autofill-runs`),
    recordAutofillRun: (id, body) =>
      request(`/applications/${id}/autofill-runs`, { method: "POST", body }),
  },
  autofill: {
    adapters: () => request("/autofill/adapters"),
    detect: (url) =>
      request(`/autofill/adapters/detect${queryString({ url })}`),
  },
  ai: {
    status: () => request("/ai/status"),
    coverLetter: (body) =>
      request("/ai/cover-letter", { method: "POST", body }),
    resumeSuggestions: (body) =>
      request("/ai/resume-suggestions", { method: "POST", body }),
    applicationAnswers: (body) =>
      request("/ai/application-answers", { method: "POST", body }),
  },
  dashboard: {
    get: () => request("/dashboard"),
  },
};

export function fieldError(error, field) {
  return error?.errors?.find((entry) => entry.field === field)?.message || "";
}
