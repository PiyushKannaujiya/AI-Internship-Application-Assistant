// Hardened HTML fetcher for the URL import feature.
//
// node:http(s) is used instead of fetch so we can:
// - pin each connection to the address we already validated (DNS rebinding),
// - follow redirects manually and re-validate every hop,
// - enforce a hard deadline and a response-size cap while streaming.

import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/ApiError.js";
import { assertSafeTarget } from "../../utils/safeUrl.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "application/xml",
  "text/plain",
];

function upstreamError(statusCode, code, message, details) {
  return new ApiError(statusCode, message, { code, details });
}

function requestOnce({ url, address, timeoutMs, maxBytes, headers }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const family = address ? isIP(address) : 0;

    const options = {
      method: "GET",
      hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "en-US,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; InternshipAssistant/1.0)",
        ...headers,
      },
      // The certificate must match the hostname, not the pinned address.
      ...(url.protocol === "https:" ? { servername: hostname } : {}),
      ...(address
        ? {
            // Node asks for the full address list (options.all) when connecting
            // to a hostname, and for a single address otherwise.
            lookup: (_host, lookupOptions, callback) => {
              if (lookupOptions?.all) {
                return callback(null, [
                  { address, family: family || 4 },
                ]);
              }
              return callback(null, address, family || 4);
            },
          }
        : {}),
    };

    let settled = false;
    let deadline;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      fn(value);
    };

    const request = transport.request(options, (response) => {
      const status = response.statusCode || 0;
      const contentType = String(response.headers["content-type"] || "")
        .split(";")[0]
        .trim()
        .toLowerCase();

      if (REDIRECT_STATUSES.has(status)) {
        response.resume();
        return finish(resolve, {
          status,
          redirect: response.headers.location,
          contentType,
          bytes: 0,
        });
      }

      if (status >= 400) {
        response.resume();
        return finish(resolve, { status, html: "", contentType, bytes: 0 });
      }

      if (contentType && !HTML_TYPES.some((type) => contentType.includes(type))) {
        response.destroy();
        return finish(
          reject,
          upstreamError(
            415,
            "UNSUPPORTED_CONTENT_TYPE",
            "That URL does not point to an HTML job page",
            [{ field: "url", message: `Unsupported content type: ${contentType}` }]
          )
        );
      }

      const chunks = [];
      let bytes = 0;

      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          response.destroy();
          finish(
            reject,
            upstreamError(
              413,
              "RESPONSE_TOO_LARGE",
              "That job page is too large to import safely",
              [{ field: "url", message: `Limit is ${maxBytes} bytes` }]
            )
          );
          return;
        }
        chunks.push(chunk);
      });

      response.on("end", () => {
        finish(resolve, {
          status,
          html: Buffer.concat(chunks).toString("utf8"),
          contentType,
          bytes,
        });
      });

      response.on("error", (error) => {
        finish(
          reject,
          upstreamError(502, "UPSTREAM_ERROR", "The job page could not be read", [
            { field: "url", message: error?.message || "stream error" },
          ])
        );
      });
    });

    deadline = setTimeout(() => {
      request.destroy();
      finish(
        reject,
        upstreamError(
          504,
          "UPSTREAM_TIMEOUT",
          "That job page took too long to respond",
          [{ field: "url", message: `Timed out after ${timeoutMs}ms` }]
        )
      );
    }, timeoutMs);
    deadline.unref?.();

    request.on("error", (error) => {
      if (error?.code === "ENOTFOUND" || error?.code === "EAI_AGAIN") {
        return finish(
          reject,
          upstreamError(400, "URL_BLOCKED", "That hostname could not be resolved")
        );
      }

      finish(
        reject,
        upstreamError(502, "UPSTREAM_ERROR", "The job page could not be reached", [
          { field: "url", message: error?.message || "request failed" },
        ])
      );
    });

    request.end();
  });
}

export async function fetchJobPage(rawUrl, {
  timeoutMs = env.URL_IMPORT_TIMEOUT_MS,
  maxBytes = env.URL_IMPORT_MAX_BYTES,
  maxRedirects = env.URL_IMPORT_MAX_REDIRECTS,
  allowHttp = env.URL_IMPORT_ALLOW_HTTP,
  allowPrivate = env.URL_IMPORT_ALLOW_PRIVATE_HOSTS,
  guard,
  headers,
} = {}) {
  const validate =
    guard ||
    ((url, options) =>
      assertSafeTarget(url, {
        allowHttp: options?.allowHttp ?? allowHttp,
        allowPrivate: options?.allowPrivate ?? allowPrivate,
      }));

  const deadline = Date.now() + timeoutMs;
  const hops = [];

  let target = await validate(rawUrl, { allowHttp, allowPrivate });
  hops.push(target.url.toString());

  for (let attempt = 0; attempt <= maxRedirects; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw upstreamError(
        504,
        "UPSTREAM_TIMEOUT",
        "That job page took too long to respond"
      );
    }

    const result = await requestOnce({
      url: target.url,
      address: target.addresses?.[0],
      timeoutMs: remaining,
      maxBytes,
      headers,
    });

    if (!result.redirect) {
      return {
        status: result.status,
        finalUrl: target.url.toString(),
        html: result.html,
        contentType: result.contentType,
        bytes: result.bytes,
        hops,
      };
    }

    if (attempt === maxRedirects) {
      throw upstreamError(
        502,
        "TOO_MANY_REDIRECTS",
        "That URL redirected too many times"
      );
    }

    let nextUrl;
    try {
      nextUrl = new URL(result.redirect, target.url).toString();
    } catch {
      throw upstreamError(
        502,
        "INVALID_REDIRECT",
        "That URL redirected to an invalid location"
      );
    }

    // Every hop is validated exactly like the original URL.
    target = await validate(nextUrl, { allowHttp, allowPrivate });
    hops.push(target.url.toString());
  }

  throw upstreamError(502, "TOO_MANY_REDIRECTS", "That URL redirected too many times");
}

export { REDIRECT_STATUSES };
