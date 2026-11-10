// VERA SEMANTIC CACHE — the same question, answered once.
// (Approach from VERA in embr3-ucds: services/vera/semanticCache.js.)
//
// Portal users ask the same few things in many wordings ("how do I upload my
// excel", "how to upload an excel file?"). A model answer is kept and handed to
// the next person who asks something close enough, so the second asking costs no
// request and no tokens — which matters on a free tier with a daily quota.
//
// "Close enough" is measured on the question's stems (veraAssistant.tokenize:
// the same stemmer and stop words retrieval uses), as Jaccard similarity, AND the
// help articles retrieved for it must be the same ones. The second condition is
// what keeps a near-miss from being served: two questions that pull different
// articles get different answers.
//
// What is never cached, so nothing personal or live is ever shared:
//   - an answer that used live data: page data on screen, a portal user's own
//     readiness/facts, or the admin's live operational metrics
//   - an answer to a follow-up (it depends on that conversation)
//   - anything but a model answer (guards and the help library cost nothing)
// and every entry is partitioned by who may see it — realm, role, developer
// mode, screen, and the settings version — so a Developer's answer never reaches
// a portal user.
//
// Process memory only: nothing about a question is written anywhere.
//   VERA_SEMANTIC_CACHE=false     off for the whole server
//   VERA_CACHE_TTL_MS             how long an answer is kept (default 12 h)
//   VERA_CACHE_MAX                entries kept (default 500, oldest dropped)
//   VERA_CACHE_SIMILARITY         0.5..1, default 0.8

const num = (v, fallback) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? fallback : Number(v));
const TTL_MS = () => num(process.env.VERA_CACHE_TTL_MS, 12 * 60 * 60 * 1000);
const MAX_ENTRIES = () => num(process.env.VERA_CACHE_MAX, 500);
const THRESHOLD = () => Math.min(1, Math.max(0.5, num(process.env.VERA_CACHE_SIMILARITY, 0.8)));

const enabled = (cfg) => cfg?.semanticCache !== false && String(process.env.VERA_SEMANTIC_CACHE || "").toLowerCase() !== "false";

// "Can I delete it" and "can't I delete it" share every stem but one; a negation
// on one side only is never a match.
const NEGATION_RE = /\b(not|no|never|cannot|can'?t|don'?t|doesn'?t|won'?t|isn'?t|aren'?t|wasn'?t|without|hindi|wala)\b/i;

/** partition -> Map(id -> entry). Insertion order doubles as age. */
const store = new Map();
let size = 0;
let born = 0;
let hits = 0;
let misses = 0;
let tokensSaved = 0;

/** Who may see an answer: entries never cross these lines. */
function partitionOf({ realm, role, devMode, page, version }) {
  return [realm || "", role || "", devMode ? "dev" : "", String(page || "").toLowerCase(), version || ""].join("|");
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const t of a) if (b.has(t)) common += 1;
  return common / (a.size + b.size - common);
}

const sameHits = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

function prune(now) {
  for (const [key, entries] of store) {
    for (const [id, e] of entries) {
      if (e.expires <= now) {
        entries.delete(id);
        size -= 1;
      }
    }
    if (!entries.size) store.delete(key);
  }
  while (size > MAX_ENTRIES()) {
    let oldest = null;
    for (const [key, entries] of store) {
      const [id, entry] = entries.entries().next().value;
      if (!oldest || entry.born < oldest.born) oldest = { key, id, born: entry.born };
    }
    if (!oldest) break;
    const entries = store.get(oldest.key);
    entries.delete(oldest.id);
    size -= 1;
    if (!entries.size) store.delete(oldest.key);
  }
}

/** Build the cache query for a question. */
function queryOf({ partition, message, stems, hitIds }) {
  return {
    partition,
    stems: stems instanceof Set ? stems : new Set(stems || []),
    negated: NEGATION_RE.test(String(message || "")),
    hitIds: (hitIds || []).map(String),
  };
}

/** A cached answer for this question, or null. */
function lookup(q) {
  const entries = store.get(q.partition);
  const now = Date.now();
  let best = null;
  let bestScore = 0;
  if (entries) {
    for (const e of entries.values()) {
      if (e.expires <= now || e.negated !== q.negated || !sameHits(e.hitIds, q.hitIds)) continue;
      const score = jaccard(e.stems, q.stems);
      if (score > bestScore) {
        best = e;
        bestScore = score;
      }
    }
  }
  if (best && bestScore >= THRESHOLD()) {
    hits += 1;
    best.uses += 1;
    tokensSaved += best.tokens || 0;
    return { answer: best.answer, similarity: bestScore };
  }
  misses += 1;
  return null;
}

function remember(q, answer, tokens = 0) {
  if (!answer || !q.stems.size) return;
  const now = Date.now();
  let entries = store.get(q.partition);
  if (!entries) {
    entries = new Map();
    store.set(q.partition, entries);
  }
  const id = `${[...q.stems].sort().join(" ")}|${q.hitIds.join(",")}`;
  // Out and in again when already there: the end of the partition is the youngest.
  if (!entries.delete(id)) size += 1;
  born += 1;
  entries.set(id, { stems: q.stems, negated: q.negated, hitIds: q.hitIds.slice(), answer, tokens, expires: now + TTL_MS(), uses: 0, born });
  prune(now);
}

function clear() {
  store.clear();
  size = 0;
}

/** Counts only — never a question or an answer — for the settings screen. */
const stats = () => ({ entries: size, hits, misses, tokensSaved, ttlHours: Math.round(TTL_MS() / 3600000), similarity: THRESHOLD() });

module.exports = { enabled, partitionOf, queryOf, lookup, remember, clear, stats, jaccard, NEGATION_RE };
