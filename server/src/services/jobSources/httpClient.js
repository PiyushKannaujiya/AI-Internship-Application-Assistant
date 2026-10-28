// Small JSON client used by the job source adapters.
//
// Every failure is classified so discovery can report *which* source failed and
// why, without leaking provider payloads or internal errors to the client.

export class SourceError extends Error {
  constructor(code, message, { status, cause } = {}) {
    super(message);
    this.name = "SourceError";
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

const MAX_JSON_BYTES = 8 * 1024 * 1024;

function timeoutSignal(timeoutMs) {
  // AbortSignal.timeout is available on Node 18+. Fall back defensively so a
  // source adapter never hangs the whole discovery request.
  if (typeof AbortSignal?.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}

export function classifyFetchError(error) {
  const name = error?.name || "";
  const message = error?.message || "";

  if (
    name === "TimeoutError" ||
    name === "AbortError" ||
    /timed? ?out|aborted/i.test(message)
  ) {
    return new SourceError("timeout", "The job source did not respond in time", {
      cause: error,
    });
  }

  return new SourceError(
    "unreachable",
    "The job source could not be reached",
    { cause: error }
  );
}

/**
 * Fetch JSON from a provider with a hard timeout.
 * Throws SourceError with a stable, client-safe code.
 */
export async function fetchJson(url, {
  timeoutMs = 8000,
  headers = {},
  accept = "application/json",
} = {}) {
  let response;

  try {
    response = await fetch(url, {
      headers: { Accept: accept, "User-Agent": "internship-assistant/1.0", ...headers },
      signal: timeoutSignal(timeoutMs),
      redirect: "follow",
    });
  } catch (error) {
    throw classifyFetchError(error);
  }

  if (!response || typeof response.ok !== "boolean") {
    throw new SourceError(
      "invalid_response",
      "The job source returned an unusable response"
    );
  }

  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw new SourceError(
      "response_too_large",
      "The job source returned more data than allowed"
    );
  }

  if (!response.ok) {
    throw new SourceError(
      response.status >= 500 ? "provider_error" : "rejected",
      "The job source rejected the request",
      { status: response.status }
    );
  }

  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(
      "invalid_response",
      "The job source returned unreadable data",
      { cause: error }
    );
  }
}

export function parseTargetParameter(value, { pattern = /^[a-zA-Z0-9_-]{1,80}$/ } = {}) {
  const raw = Array.isArray(value) ? value.join(",") : value;
  if (!raw) return [];

  return [
    ...new Set(
      String(raw)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    ),
  ].filter((entry) => {
    if (!pattern.test(entry)) {
      throw new SourceError(
        "invalid_target",
        "Source board names may only contain letters, numbers, dashes, and underscores"
      );
    }
    return true;
  });
}
