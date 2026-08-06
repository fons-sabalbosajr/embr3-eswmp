/**
 * DNS bootstrap for c-ares (Node's `dns.resolve*` family).
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * `mongodb+srv://` connection strings require SRV + TXT lookups. Those go
 * through c-ares (`dns.resolveSrv`), NOT through the operating system resolver
 * that `dns.lookup()`/getaddrinfo uses. c-ares keeps its own copy of the
 * nameserver list, imported from the OS at process start.
 *
 * On Windows that import is fragile. c-ares walks the adapter list and skips
 * entries it considers unusable; when every adapter it looks at only advertises
 * Windows' site-local IPv6 placeholder resolvers (`fec0:0:0:ffff::1..3`, which
 * are never actually routable), c-ares ends up with an empty list and falls back
 * to its compiled-in default of `127.0.0.1`. Nothing listens on 127.0.0.1:53 on
 * a normal desktop, so every SRV lookup fails instantly with ECONNREFUSED —
 * even though the machine has perfectly good DNS and every other network call
 * works, because those go through getaddrinfo.
 *
 * A machine hits this depending on which virtual adapters are installed and in
 * what binding order (Tailscale/VPN, Hyper-V, WSL, VirtualBox, Bluetooth PAN),
 * which is exactly why the failure looks intermittent and PC-specific.
 *
 * ── What this module does ───────────────────────────────────────────────────
 * Repairs c-ares' nameserver list from the machine's *real* configuration
 * instead of blindly jumping to public DNS:
 *
 *   1. Inspect `dns.getServers()`. If it holds at least one plausibly usable
 *      address, verify it with a single cheap probe and stop there (zero cost,
 *      no log noise, on healthy machines).
 *   2. Otherwise discover the nameservers the OS actually has configured
 *      (Windows: Get-DnsClientServerAddress; POSIX: /etc/resolv.conf).
 *   3. Probe every candidate in parallel with isolated `dns.Resolver` instances
 *      and a tight timeout, so the global resolver is never mutated with a
 *      server that has not been proven to answer.
 *   4. Install the winners via `dns.setServers()`. The MongoDB driver's own
 *      SRV/TXT lookups then use them too.
 *   5. Only if the machine's own resolvers all fail do we fall back to the
 *      configured public resolvers.
 */

const dns = require("dns");
const fs = require("fs");
const { execFile } = require("child_process");

const { Resolver: PromiseResolver } = dns.promises;

/** Probe budget per candidate nameserver. Kept tight so startup never stalls. */
const PROBE_TIMEOUT_MS = Number(process.env.DNS_PROBE_TIMEOUT_MS || 2000);
/** Budget for shelling out to the OS to read its nameserver configuration. */
const OS_DISCOVERY_TIMEOUT_MS = Number(process.env.DNS_DISCOVERY_TIMEOUT_MS || 5000);

/** Cached OS nameserver discovery — the config does not change mid-process. */
let systemServersPromise = null;

/**
 * Strip the decorations Node may attach to a nameserver entry:
 * `8.8.8.8:53`, `[::1]:53`, `fe80::1%eth0`.
 */
function normalizeServer(value) {
  let address = String(value || "").trim();
  if (!address) return "";

  // [addr]:port  →  addr
  const bracketed = address.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) {
    address = bracketed[1];
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(address)) {
    // IPv4:port — safe to split because IPv6 without brackets has no port
    address = address.split(":")[0];
  }

  // Drop any zone index (fe80::1%12) — c-ares cannot use scoped addresses here.
  const zone = address.indexOf("%");
  if (zone !== -1) address = address.slice(0, zone);

  return address;
}

/**
 * Addresses that can never serve real DNS and only waste a probe slot:
 * unspecified addresses, IPv6 link-local, and the Windows `fec0::/10`
 * site-local placeholders that ship on every freshly created adapter.
 */
function isPlaceholderServer(address) {
  if (!address) return true;
  const lower = address.toLowerCase();
  if (lower === "0.0.0.0" || lower === "::" || lower === "::0") return true;
  if (lower.startsWith("fec0:")) return true; // Windows site-local placeholders
  if (lower.startsWith("fe80:")) return true; // IPv6 link-local
  return false;
}

function isLoopbackServer(address) {
  const lower = String(address || "").toLowerCase();
  return lower === "::1" || lower.startsWith("127.");
}

/**
 * Read the nameservers the operating system actually has configured.
 * Loopback entries are dropped: a loopback nameserver in the OS config is
 * meaningful (a local resolver such as dnsmasq/systemd-resolved), but a
 * loopback entry is already covered as a candidate by the c-ares list, and
 * re-adding it here would just mask a genuinely broken configuration.
 */
function readSystemDnsServers() {
  if (systemServersPromise) return systemServersPromise;

  systemServersPromise = (process.platform === "win32"
    ? readWindowsDnsServers()
    : readResolvConfServers()
  )
    .then((servers) => servers.map(normalizeServer).filter((s) => s && !isPlaceholderServer(s)))
    .catch(() => []);

  return systemServersPromise;
}

function readWindowsDnsServers() {
  // Get-DnsClientServerAddress reports the per-adapter configuration that
  // c-ares failed to import. Adapters are ordered by interface metric so the
  // most-preferred route's resolvers come first.
  const script = [
    "$ErrorActionPreference='Stop';",
    "Get-DnsClientServerAddress",
    "| Where-Object { $_.ServerAddresses.Count -gt 0 }",
    "| Sort-Object InterfaceIndex",
    "| ForEach-Object { $_.ServerAddresses }",
    "| ForEach-Object { Write-Output $_ }",
  ].join(" ");

  return execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    OS_DISCOVERY_TIMEOUT_MS,
  ).then((stdout) => stdout.split(/\r?\n/));
}

function readResolvConfServers() {
  return fs.promises.readFile("/etc/resolv.conf", "utf8").then((text) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.toLowerCase().startsWith("nameserver"))
      .map((line) => line.split(/\s+/)[1] || ""),
  );
}

function execFileAsync(file, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) reject(error);
      else resolve(stdout || "");
    });
  });
}

/**
 * Ask a single nameserver for `recordName` using an isolated resolver, so a
 * failed probe never disturbs the process-wide resolver configuration.
 * Resolves to the SRV records on success, rejects otherwise.
 */
function probeServer(address, recordName) {
  return new Promise((resolve, reject) => {
    let resolver;
    try {
      resolver = new PromiseResolver({ timeout: PROBE_TIMEOUT_MS, tries: 1 });
      resolver.setServers([address]);
    } catch (error) {
      reject(error);
      return;
    }

    // c-ares honours `timeout` per try, but a server that black-holes packets
    // can still outlive it on some platforms; this guard keeps startup bounded.
    const guard = setTimeout(() => {
      try { resolver.cancel(); } catch { /* resolver already settled */ }
      reject(Object.assign(new Error(`DNS probe timed out via ${address}`), { code: "ETIMEOUT" }));
    }, PROBE_TIMEOUT_MS + 250);

    resolver
      .resolveSrv(recordName)
      .then((records) => {
        if (!records || records.length === 0) {
          throw Object.assign(new Error("Empty SRV response"), { code: "ENODATA" });
        }
        resolve({ address, records });
      })
      .catch(reject)
      .finally(() => clearTimeout(guard));
  });
}

/**
 * Race a set of candidate nameservers and return every one that answered,
 * ordered by the priority they were supplied in. Probing runs fully in
 * parallel, so the wall-clock cost is one probe timeout regardless of how
 * many candidates there are.
 */
async function probeServers(candidates, recordName) {
  const results = await Promise.allSettled(
    candidates.map((address) => probeServer(address, recordName)),
  );

  const healthy = [];
  let records = null;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      healthy.push(candidates[index]);
      if (!records) records = result.value.records;
    }
  });

  return { healthy, records };
}

/**
 * Ensure c-ares can resolve `recordName`, repairing its nameserver list if not.
 *
 * @returns {Promise<{ status: string, servers: string[], records: object[]|null, detail?: string }>}
 *   status is one of:
 *     "ok"        — the existing resolver configuration works, nothing changed
 *     "repaired"  — the resolver list was replaced with verified servers
 *     "failed"    — no candidate could resolve the record
 */
async function ensureResolvable(recordName, fallbackServers = []) {
  const current = dns.getServers().map(normalizeServer).filter(Boolean);
  const usableCurrent = current.filter((s) => !isPlaceholderServer(s));
  const hasRoutableCurrent = usableCurrent.some((s) => !isLoopbackServer(s));
  let fastPathError = null;

  // Fast path: the configuration looks sane, so verify it with one probe and
  // leave everything alone. Costs a single UDP round trip (~20–50 ms).
  if (hasRoutableCurrent) {
    try {
      const records = await probeCurrentResolver(recordName);
      return { status: "ok", servers: current, records };
    } catch (error) {
      fastPathError = error; // fall through to repair
    }
  }

  // Repair path. Candidate priority:
  //   1. servers the OS reports (the configuration c-ares failed to import)
  //   2. whatever c-ares currently holds, loopback last (a loopback entry is
  //      usually the c-ares default rather than a real local resolver)
  //   3. configured public resolvers, as a genuine last resort
  const systemServers = await readSystemDnsServers();
  const caresRoutable = usableCurrent.filter((s) => !isLoopbackServer(s));
  const caresLoopback = usableCurrent.filter(isLoopbackServer);

  // The machine's own resolvers are kept separate from the public fallbacks:
  // a corporate/split-horizon resolver may be the only one that can answer
  // internal names, so public DNS must never displace a working local server.
  const localCandidates = dedupe([...systemServers, ...caresRoutable, ...caresLoopback]);
  const fallbackCandidates = dedupe(
    fallbackServers.map(normalizeServer).filter((s) => s && !isPlaceholderServer(s)),
  ).filter((s) => !localCandidates.some((local) => local.toLowerCase() === s.toLowerCase()));

  const candidates = [...localCandidates, ...fallbackCandidates];

  if (candidates.length === 0) {
    return {
      status: "failed",
      servers: current,
      records: null,
      detail: "no candidate nameservers could be discovered",
    };
  }

  const { healthy, records } = await probeServers(candidates, recordName);

  // Prefer the machine's own working resolvers; only reach for the public
  // fallbacks when every local one failed.
  const healthyLocal = healthy.filter((s) => localCandidates.includes(s));
  const selected = healthyLocal.length ? healthyLocal : healthy;

  if (healthy.length === 0) {
    return {
      status: "failed",
      servers: current,
      records: null,
      detail:
        fastPathError?.code
          ? `${fastPathError.code} — none of ${candidates.length} candidate nameserver(s) answered`
          : `none of ${candidates.length} candidate nameserver(s) answered`,
    };
  }

  try {
    dns.setServers(selected);
  } catch (error) {
    return { status: "failed", servers: current, records: null, detail: error.message };
  }

  return {
    status: "repaired",
    servers: selected,
    records,
    detail: describeRepairReason(current, systemServers, selected),
  };
}

/** Probe using the process-wide resolver, bounded by the probe timeout. */
function probeCurrentResolver(recordName) {
  return Promise.race([
    dns.promises.resolveSrv(recordName),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(Object.assign(new Error("DNS probe timed out"), { code: "ETIMEOUT" })),
        PROBE_TIMEOUT_MS + 250,
      ),
    ),
  ]);
}

/** Human-readable explanation of *why* the resolver list had to be replaced. */
function describeRepairReason(previous, systemServers, healthy) {
  const previousList = previous.length ? previous.join(", ") : "(empty)";
  const recoveredFromOs = healthy.some((server) => systemServers.includes(server));

  if (previous.every(isLoopbackServer)) {
    return recoveredFromOs
      ? `Node's DNS client held only loopback (${previousList}) because it could not import this machine's adapter configuration; recovered the real nameservers from the OS`
      : `Node's DNS client held only loopback (${previousList}) and the OS configuration was unusable; using configured fallback resolvers`;
  }

  return recoveredFromOs
    ? `previous resolvers (${previousList}) did not answer; recovered working nameservers from the OS configuration`
    : `previous resolvers (${previousList}) did not answer; using configured fallback resolvers`;
}

function dedupe(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

module.exports = {
  ensureResolvable,
  normalizeServer,
  isPlaceholderServer,
  isLoopbackServer,
  readSystemDnsServers,
  PROBE_TIMEOUT_MS,
};
