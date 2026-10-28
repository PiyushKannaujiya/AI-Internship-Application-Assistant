// SSRF protection for user-supplied URLs.
//
// A URL is only considered safe when:
// - it uses https (plain http needs an explicit, non-production opt-in),
// - it has no embedded credentials and no unusual port,
// - its hostname is not localhost or another reserved name,
// - every address it resolves to is public (checked again on each redirect).

import { lookup as defaultLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ApiError } from "./ApiError.js";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.azure.internal",
  "instance-data",
  "instance-data.ec2.internal",
  "host.docker.internal",
  "gateway.docker.internal",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home.arpa",
  ".corp",
];

const DEFAULT_PORTS = new Set([80, 443]);

export function blockedUrl(reason, message = "That URL cannot be imported") {
  return new ApiError(400, message, {
    code: "URL_BLOCKED",
    details: [{ field: "url", message: reason }],
  });
}

function isIpv4Private(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b] = parts;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 88 && parts[2] === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
  if (a >= 224) return true; // multicast + reserved + broadcast

  return false;
}

function embeddedIpv4(address) {
  const match = address.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  return match ? match[1] : null;
}

function isIpv6Private(address) {
  const value = address.toLowerCase().split("%")[0];

  if (value === "::" || value === "::1") return true;

  const mapped = embeddedIpv4(value);
  if (mapped && (value.startsWith("::ffff:") || value.startsWith("64:ff9b::"))) {
    return isIpv4Private(mapped);
  }

  // fe80::/10 link-local, fc00::/7 unique-local, ff00::/8 multicast.
  if (/^fe[89ab]/.test(value)) return true;
  if (/^f[cd]/.test(value)) return true;
  if (/^ff/.test(value)) return true;
  // 2001:db8::/32 documentation range and 100::/64 discard prefix.
  if (value.startsWith("2001:db8") || value.startsWith("100::")) return true;

  return false;
}

export function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 4) return isIpv4Private(address);
  if (family === 6) return isIpv6Private(address);
  return true;
}

export function normalizeHostname(hostname) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function assertHostnameAllowed(hostname, { allowPrivate = false } = {}) {
  const host = normalizeHostname(hostname);

  if (!host) throw blockedUrl("The URL has no hostname");

  if (BLOCKED_HOSTNAMES.has(host)) {
    throw blockedUrl("Local and internal hostnames are not allowed");
  }

  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw blockedUrl("Local and internal hostnames are not allowed");
  }

  if (isIP(host) && isPrivateAddress(host) && !allowPrivate) {
    throw blockedUrl("Private, loopback, and reserved addresses are not allowed");
  }

  return host;
}

/**
 * Validate a candidate URL (also used for every redirect hop).
 * Resolves DNS and rejects the URL when any answer is private.
 */
export async function assertSafeTarget(
  rawUrl,
  {
    allowHttp = false,
    allowPrivate = false,
    resolver = defaultLookup,
  } = {}
) {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    throw blockedUrl("That is not a valid absolute URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw blockedUrl("Only http(s) URLs can be imported");
  }

  if (url.protocol === "http:" && !allowHttp) {
    throw blockedUrl("Only HTTPS URLs can be imported");
  }

  if (url.username || url.password) {
    throw blockedUrl("URLs with embedded credentials are not allowed");
  }

  const host = assertHostnameAllowed(url.hostname, { allowPrivate });

  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!DEFAULT_PORTS.has(port) && !allowPrivate) {
    throw blockedUrl("Only standard HTTPS ports are allowed");
  }

  if (allowPrivate) {
    // Development/test only: the address was explicitly allowed above.
    return { url, addresses: isIP(host) ? [host] : [] };
  }

  let records;
  try {
    records = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await resolver(host, { all: true, verbatim: true });
  } catch {
    throw blockedUrl("That hostname could not be resolved");
  }

  const addresses = (Array.isArray(records) ? records : [records])
    .map((record) => record?.address)
    .filter(Boolean);

  if (!addresses.length) {
    throw blockedUrl("That hostname could not be resolved");
  }

  if (addresses.some((address) => isPrivateAddress(address))) {
    throw blockedUrl("Private, loopback, and reserved addresses are not allowed");
  }

  return { url, addresses };
}
