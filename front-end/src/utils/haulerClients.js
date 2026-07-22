// Aggregate the distinct Haulers→Clients declared across every SLF Portal user's
// baseline, associating each client with the portal user(s) / SLF(s) that list it.
//
// Source: Portal Side → Baseline → accreditedHaulers → (clients | privateSectorClients).
// Each baseline carries a `submittedBy` (portal-user email) and `slfName`, so a
// client can be traced back to the portal user(s) who maintain it.
//
// Grouping rule: names are compared case-insensitively after trimming, but the
// FIRST-seen original spelling is kept as the display name. Genuinely different
// names never merge (only exact normalized matches group). Missing/deleted portal
// users degrade to the raw email or "Unknown".

// A client entry may be a plain string or an object ({clientName, clientType,…}).
function readClient(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    const name = entry.trim();
    return name ? { name, type: "" } : null;
  }
  if (typeof entry === "object") {
    const name = String(entry.clientName || entry.name || "").trim();
    if (!name) return null;
    return { name, type: String(entry.clientType || "").trim() };
  }
  return null;
}

const normKey = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");

// Canonical LGU / Private / Unclassified classification for a client. The baseline
// stores a per-client `clientType` enum ("LGU" | "Private") on EACH client — the
// `privateSectorClients[]` array actually holds both LGU and Private clients (its
// name is historical), so the classification always follows the client's own
// `clientType` value, never the array it came from. The stored value is respected —
// capitalization / spaces / underscores are normalized ("l g u", "lgu_client",
// "LGU " → LGU; "private" → Private) — and there is NO fallback that silently marks
// unknown values as Private: a missing or unrecognized type is "Unclassified".
export function classifyClientType(type) {
  const low = String(type ?? "").toLowerCase().replace(/[_\-\s]+/g, " ").trim();
  if (!low) return "Unclassified";
  if (/\blgu\b/.test(low) || low.includes("local government")) return "LGU";
  if (low.includes("private")) return "Private";
  return "Unclassified";
}

// Shared counting logic used by BOTH the dashboard tile and the Clients modal so
// the summaries can never disagree. Operates on an already-deduped client list
// (distinct by normalized name), so a client listed across many submissions counts
// once. `type` is already the normalized classification from aggregateHaulerClients.
export function countClientsByType(clients = []) {
  return (Array.isArray(clients) ? clients : []).reduce(
    (acc, c) => {
      acc.total += 1;
      const t = c.type === "LGU" || c.type === "Private" ? c.type : classifyClientType(c.type);
      if (t === "LGU") acc.lgu += 1;
      else if (t === "Private") acc.private += 1;
      else acc.unclassified += 1;
      return acc;
    },
    { total: 0, lgu: 0, private: 0, unclassified: 0 },
  );
}

// Group an aggregated client list by its associated Portal User or SLF Facility
// (#3). A client tied to multiple owners appears under each owner (that is the real
// association, not a double-count) but is deduped WITHIN a group by client key.
// Each group carries its own type totals via the shared countClientsByType.
export function groupHaulerClients(clients = [], groupBy = "user") {
  const field = groupBy === "slf" ? "slfs" : "portalUsers";
  const groups = new Map();
  (Array.isArray(clients) ? clients : []).forEach((c) => {
    const owners = Array.isArray(c[field]) && c[field].length ? c[field] : ["—"];
    owners.forEach((owner) => {
      let g = groups.get(owner);
      if (!g) {
        g = { key: owner, owner, seen: new Set(), clients: [] };
        groups.set(owner, g);
      }
      if (!g.seen.has(c.key)) {
        g.seen.add(c.key);
        g.clients.push(c);
      }
    });
  });
  return [...groups.values()]
    .map((g) => ({
      key: g.key,
      owner: g.owner,
      clients: g.clients.sort((a, b) => a.name.localeCompare(b.name)),
      ...countClientsByType(g.clients),
    }))
    .sort((a, b) => b.total - a.total || String(a.owner).localeCompare(String(b.owner)));
}

/**
 * @param {Array} baselines  /data-slf/baselines rows (with accreditedHaulers, submittedBy, slfName)
 * @param {Object} userByEmail  email(lowercased) → display name
 * @returns {Array<{key,name,type,portalUsers:string[],slfs:string[],userCount:number}>}
 */
export function aggregateHaulerClients(baselines, userByEmail = {}) {
  const map = new Map(); // normKey → aggregate
  (Array.isArray(baselines) ? baselines : []).forEach((b) => {
    const email = String(b?.submittedBy || "").trim().toLowerCase();
    const userName =
      (email && userByEmail[email]) || b?.submittedBy || "Unknown user";
    const slf = b?.slfName || b?.lguCompanyName || "";
    const haulers = Array.isArray(b?.accreditedHaulers) ? b.accreditedHaulers : [];
    haulers.forEach((h) => {
      // Every client the hauler declares carries its own clientType. The canonical
      // list is `privateSectorClients[]` (mixed LGU + Private); `clients[]` is a
      // legacy alias. Both are merged and deduped by name below.
      const clients = [
        ...(Array.isArray(h?.privateSectorClients) ? h.privateSectorClients : []),
        ...(Array.isArray(h?.clients) ? h.clients : []),
      ];
      clients.forEach((raw) => {
        const c = readClient(raw);
        if (!c) return;
        const key = normKey(c.name);
        if (!key) return;
        const normType = classifyClientType(c.type);
        let agg = map.get(key);
        if (!agg) {
          agg = {
            key,
            name: c.name, // preferred display = first-seen original
            type: normType,
            portalUsers: new Set(),
            slfs: new Set(),
          };
          map.set(key, agg);
        } else if (agg.type === "Unclassified" && normType !== "Unclassified") {
          // Upgrade a client first seen without a type when a later record types it.
          agg.type = normType;
        }
        if (userName) agg.portalUsers.add(userName);
        if (slf) agg.slfs.add(slf);
      });
    });
  });
  return [...map.values()]
    .map((a) => ({
      key: a.key,
      name: a.name,
      type: a.type || "",
      portalUsers: [...a.portalUsers],
      slfs: [...a.slfs],
      userCount: a.portalUsers.size,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
