// Lightweight, dependency-free IP geolocation helper.
// - Normalizes IPs (handles IPv4-mapped IPv6 like ::ffff:127.0.0.1)
// - Classifies private/loopback addresses (cannot be geolocated)
// - Looks up public IPs via the free, no-key ip-api.com endpoint with an
//   in-memory TTL cache. Lookups are kept OFF the log write path and used
//   lazily when logs are read, so they never block or crash request handling.

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const cache = new Map(); // ip -> { value, expires }

function normalizeIp(ip) {
  if (!ip) return "";
  let value = String(ip).trim();
  // Strip IPv4-mapped IPv6 prefix
  if (value.startsWith("::ffff:")) value = value.slice(7);
  if (value === "::1") value = "127.0.0.1";
  // If a comma-separated XFF list slipped through, take the first
  if (value.includes(",")) value = value.split(",")[0].trim();
  return value;
}

function isPrivateIp(ip) {
  const value = normalizeIp(ip);
  if (!value) return true;
  if (value === "127.0.0.1" || value === "localhost") return true;
  if (/^10\./.test(value)) return true;
  if (/^192\.168\./.test(value)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return true;
  if (/^169\.254\./.test(value)) return true; // link-local
  if (/^(fc|fd)/i.test(value)) return true; // IPv6 ULA
  if (/^fe80/i.test(value)) return true; // IPv6 link-local
  return false;
}

function buildLabel({ city, region, country }) {
  return [city, region, country].filter(Boolean).join(", ");
}

// Resolve a location object for an IP. Returns { source, label, ... }.
async function resolveIpLocation(rawIp) {
  const ip = normalizeIp(rawIp);
  if (!ip) return { source: "private", label: "Unknown" };
  if (isPrivateIp(ip)) {
    return { source: "private", label: "Local / Private network", ip };
  }

  const cached = cache.get(ip);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    if (typeof fetch !== "function") {
      return { source: "ip", label: ip, ip };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,lat,lon`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    const data = await res.json();
    let value;
    if (data && data.status === "success") {
      value = {
        source: "ip",
        ip,
        city: data.city || "",
        region: data.regionName || "",
        country: data.country || "",
        lat: data.lat,
        lng: data.lon,
        label: buildLabel({ city: data.city, region: data.regionName, country: data.country }) || ip,
      };
    } else {
      value = { source: "ip", label: ip, ip };
    }
    cache.set(ip, { value, expires: Date.now() + CACHE_TTL });
    return value;
  } catch {
    return { source: "ip", label: ip, ip };
  }
}

module.exports = { normalizeIp, isPrivateIp, resolveIpLocation };
