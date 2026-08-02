const FORBIDDEN_AUTHORITY = /[\u0000-\u0020\u007f/%\\?#@,]/u;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export const DEFAULT_PLATFORM_BASE_DOMAIN = "sitesourcery.me";

function isIpv4(hostname) {
  const labels = hostname.split(".");
  return (
    labels.length === 4 &&
    labels.every((label) => {
      if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(label)) return false;
      const value = Number(label);
      return value >= 0 && value <= 255;
    })
  );
}

export function normalizeHostname(authority) {
  if (
    typeof authority !== "string" ||
    authority.length < 1 ||
    authority.length > 320 ||
    authority !== authority.trim() ||
    FORBIDDEN_AUTHORITY.test(authority) ||
    authority.endsWith(":")
  ) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(`http://${authority}/`);
  } catch {
    return null;
  }
  let hostname = parsed.hostname.toLowerCase();
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  if (
    hostname.length < 3 ||
    hostname.length > 253 ||
    hostname.startsWith("[") ||
    isIpv4(hostname)
  ) {
    return null;
  }
  const labels = hostname.split(".");
  if (labels.length < 2 || labels.some((label) => !DNS_LABEL.test(label))) return null;
  return hostname;
}

export function requestHostname(request) {
  let urlHost;
  try {
    urlHost = normalizeHostname(new URL(request.url).host);
  } catch {
    return null;
  }
  if (!urlHost) return null;
  const header = request.headers.get("host");
  if (header === null) return urlHost;
  const headerHost = normalizeHostname(header);
  return headerHost === urlHost ? urlHost : null;
}

export function isPlatformHostname(hostname, baseDomain, reservedLabels = []) {
  const host = normalizeHostname(hostname);
  const base = normalizeHostname(baseDomain);
  if (!host || !base || !host.endsWith(`.${base}`)) return false;
  const prefix = host.slice(0, -(base.length + 1));
  return (
    DNS_LABEL.test(prefix) &&
    !prefix.includes(".") &&
    !new Set(reservedLabels.map((value) => String(value).toLowerCase())).has(prefix)
  );
}
