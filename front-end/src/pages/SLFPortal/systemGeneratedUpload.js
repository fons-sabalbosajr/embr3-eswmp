// ── System-generated disposal files: detection and Hauler↔Client alignment ───
//
// THE PROBLEM
// -----------
// The disposal upload assumes a file written FOR it: one column naming the
// accredited hauler, another naming that hauler's client, both spelled as the
// baseline spells them. Larger facilities do not produce that file by hand. They
// export it from their own weighbridge / gate system, which records ONE party per
// trip — whoever the ticket was issued to — and writes that single value into both
// the Hauler and the Client column.
//
// Prime Waste Solution's export is the worked example. Every row carries the same
// text twice, and that text is one of three things:
//
//   "BGC HAULERS"                                    → a hauler that is its own client
//   "MUNICIPALITY OF GUAGUA, PAMPANGA"               → a client, hauler not stated
//   "GREEN RESCUE - MUNICIPALITY OF PULILAN, BULACAN" → hauler AND client, joined
//
// None of the three matches the baseline as written, so `getUploadRelationshipErrors`
// rejected every row with "Hauler … is not assigned under this SLF" — a true
// statement that tells the operator nothing about what to do, since the hauler IS
// assigned and only the spelling in the machine's export differs.
//
// WHAT THIS DOES
// --------------
// Resolves the two raw values against the baseline the portal already has loaded
// and, when the answer is UNAMBIGUOUS, rewrites the row to the baseline's own
// spelling before validation runs. The row then passes the normal relationship
// check, and — because the rewritten names are the canonical ones — passes the
// server's submit-time check too. Nothing here loosens validation: a row that
// cannot be resolved to exactly one hauler/client pair stays invalid, but carries
// an error that names the actual missing record instead of the symptom.
//
// WHAT IT REFUSES TO DO
// ---------------------
// It never invents a client, never creates a hauler, and never picks between two
// equally plausible candidates. Ambiguity is reported, not guessed: an upload that
// silently attributed a trip to the wrong LGU would corrupt served-LGU counts and
// per-client volumes, which is a far worse outcome than a blocked import.
//
// Pure: no hooks, no state, no XLSX. Everything decidable lives here so it can be
// tested directly (see __tests__/systemGeneratedUpload.test.js).

import {
  cleanUploadText,
  clientDisplayName,
  findUploadClientForHauler,
  findUploadHauler,
  haulerClientPool,
  normalizeComparableText,
} from "./uploadHelpers.js";

// ── Detection ────────────────────────────────────────────────────────────────

// The headers the app's own generated template writes. A file carrying all of
// them is machine-produced rather than hand-assembled, whoever generated it.
const GENERATED_TEMPLATE_HEADERS = [
  "disposal date",
  "hauler",
  "client",
  "waste type",
  "waste volume",
  "unit of measurement",
  "cell or disposal area",
  "disposal ticket no",
  "plate number",
  "truck capacity",
];

const headerKey = (header) =>
  String(header || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Does this file look system-generated?
 *
 * Two independent signals, either of which is enough:
 *   · it carries the full generated-template header set, in any order; or
 *   · a clear majority of its rows repeat the same value in Hauler and Client,
 *     which is the fingerprint of a gate system that records one party per trip.
 *
 * Detection is ADVISORY. It decides what to tell the operator and what to show
 * VERA — never whether a row is valid. Alignment below runs on its own merits.
 */
export const detectSystemGeneratedFile = (headers = [], rows = []) => {
  const keys = new Set((headers || []).map(headerKey));
  const templateHeaders = GENERATED_TEMPLATE_HEADERS.filter((h) => keys.has(h));
  const matchesTemplate = templateHeaders.length === GENERATED_TEMPLATE_HEADERS.length;

  const considered = (rows || []).filter(
    (row) => cleanUploadText(row?.hauler) && cleanUploadText(row?.client),
  );
  const mirrored = considered.filter(
    (row) => normalizeComparableText(row.hauler) === normalizeComparableText(row.client),
  ).length;
  const mirroredRatio = considered.length ? mirrored / considered.length : 0;
  // Two thirds, not "any": a handful of self-hauling private companies in an
  // otherwise hand-made file is normal and must not be read as a machine export.
  const mirrorsHaulerAndClient = considered.length >= 3 && mirroredRatio >= 0.67;

  return {
    isSystemGenerated: matchesTemplate || mirrorsHaulerAndClient,
    matchesTemplate,
    mirrorsHaulerAndClient,
    mirroredRows: mirrored,
    consideredRows: considered.length,
    mirroredRatio,
  };
};

/**
 * Does this parsed row describe a disposal TRIP at all?
 *
 * Machine exports routinely carry trailing rows that hold nothing but a stray
 * value an operator left in a cell — the real Prime Waste Solution file ends with
 * three rows whose only content is a bare number in the Client column. Those rows
 * were always going to fail validation, but they also arrived in the list of
 * "clients missing from the baseline" as `6`, `1.5` and `9`, which is worse than
 * useless: the whole value of that list is that every line on it is a real record
 * somebody has to encode.
 *
 * A row counts as a trip when it carries ANY of the things a trip is made of.
 * Deliberately generous — a genuinely incomplete trip must still reach the
 * preview and be reported as incomplete, never quietly dropped. Only a row with
 * none of them is a remnant.
 */
export const isTripRow = (row = {}) =>
  Boolean(
    cleanUploadText(row.disposalDate) ||
      cleanUploadText(row.disposalTicketNo) ||
      cleanUploadText(row.plateNumber) ||
      cleanUploadText(row.cellName) ||
      cleanUploadText(row.wasteType) ||
      (row.actualVolume != null && row.actualVolume !== "" && !Number.isNaN(row.actualVolume)),
  );

// ── Compound splitting ───────────────────────────────────────────────────────

// The separators a gate system uses to join two parties into one ticket name.
// Surrounding whitespace is optional because Excel exports are inconsistent about
// it. That makes the split DELIBERATELY over-eager: plenty of single names contain
// a hyphen, and this will happily cut them in half. It is safe because a split is
// only ever accepted when one side resolves to a real accredited hauler and the
// other to a client of that same hauler — a nonsense cut resolves to nothing and
// is silently discarded.
const SPLIT_SEPARATORS = /\s*[-–—/|:]\s*/g;

const splitCandidates = (value) => {
  const text = cleanUploadText(value);
  if (!text) return [];
  const out = [];
  // EVERY split point, not just the first: "A - B - C" may be hauler "A - B" with
  // client "C" just as plausibly as hauler "A" with client "B - C", and which
  // reading is right is decided by the baseline, not by the punctuation.
  [...text.matchAll(SPLIT_SEPARATORS)].forEach((match) => {
    const left = cleanUploadText(text.slice(0, match.index));
    const right = cleanUploadText(text.slice(match.index + match[0].length));
    // Two characters minimum on both sides — a trailing "Inc. -" or a stray
    // initial produces a fragment that can only ever match by accident.
    if (left.length >= 2 && right.length >= 2) out.push({ left, right });
  });
  return out;
};

// ── Resolution ───────────────────────────────────────────────────────────────

const resolvedHauler = (hauler) =>
  hauler && !hauler.ambiguous ? hauler : null;

const haulerName = (hauler) =>
  cleanUploadText(hauler?.haulerName || hauler?.name);

/** Every baseline hauler that lists a client by this name, with that client. */
const haulersServingClient = (haulers = [], clientValue) => {
  const target = normalizeComparableText(clientValue);
  if (!target) return [];
  const out = [];
  (haulers || []).forEach((hauler) => {
    const client = haulerClientPool(hauler).find(
      (candidate) => normalizeComparableText(clientDisplayName(candidate)) === target,
    );
    if (client) out.push({ hauler, client });
  });
  return out;
};

// ── Near misses ──────────────────────────────────────────────────────────────
//
// A MISMATCH is not the same failure as a missing record, and the operator's fix
// is different: a missing client has to be added, a mismatched one has to be
// spelled the same way in both places. Telling them apart is the difference
// between "add three clients" and "these are the same client, twice".
//
// The case this was built from, straight out of a live upload:
//
//   file says   "GREEN RESCUE - MUNICIPALITY OF PULILAN, BULACAN"
//   baseline has "GREEN RESCUE - MUNICIPALITY OF PULILAN"   ← same client
//                "LGU of Pulilan, BULACAN"                  ← also same client
//
// Nothing is auto-corrected on the strength of a score. The row stays blocked and
// the candidates are offered for a person to accept, because "these two strings
// are similar" is evidence, not proof, and attributing a trip to the wrong LGU is
// the one outcome worth blocking an import over.

// NOT a similarity score. Character similarity is useless on these names and
// actively dangerous: "Municipality of Nowhere, Bulacan" and "Municipality of
// Pulilan, Bulacan" are ~85% identical as strings and are two different LGUs, so
// any threshold loose enough to catch a real mismatch also proposes attributing
// a trip to the wrong municipality. The boilerplate ("municipality of …", "city
// of …", ", <province>") is most of the string and carries none of the identity.
//
// The rule is containment instead, which is what a real mismatch actually looks
// like — one side carries a qualifier the other drops:
//
//   CONTIGUOUS  "green rescue municipality of pulilan"
//             ⊂ "green rescue municipality of pulilan bulacan"
//   TOKEN       "abc manufacturing corp" vs "abc manufacturing corporation"
//               — every word of the shorter name appears in the longer one,
//                 allowing an abbreviation to prefix-match the word it shortens.
//
// It has no tuning knob and no false-positive tail: "nowhere" does not appear in,
// and does not prefix, any word of "municipality of pulilan bulacan", so those two
// are correctly reported as different clients.

const WORD_PREFIX_MIN = 3; // "corp" → "corporation"; never "a" → "angeles"

const tokensOf = (value) => String(value || "").split(" ").filter(Boolean);

/** Every word of `shorter` appears in `longer`, an abbreviation matching what it shortens. */
const tokenSubset = (shorter, longer) => {
  const pool = tokensOf(longer);
  return tokensOf(shorter).every((token) =>
    pool.some(
      (candidate) =>
        candidate === token ||
        (token.length >= WORD_PREFIX_MIN && candidate.startsWith(token)) ||
        (candidate.length >= WORD_PREFIX_MIN && token.startsWith(candidate)),
    ),
  );
};

/** One normalized name contains the other as a contiguous run of whole words. */
const containsWholeWords = (a, b) =>
  a.startsWith(`${b} `) || a.endsWith(` ${b}`) || a.includes(` ${b} `);

/**
 * Is the shorter name enough of the longer one to be evidence they are the same
 * client?
 *
 * Containment alone is not: "ABC" is contained in "ABC Manufacturing Corporation"
 * and tells you nothing — a short prefix is inside half the names in any fleet.
 * A real mismatch differs by a QUALIFIER, so the two names are nearly the same
 * length; requiring at least two words and 40% of the longer name's characters
 * admits "… OF PULILAN" against "… OF PULILAN, BULACAN" (82%) while rejecting
 * "ABC" (10%) and a bare prefix like "City of" (35%).
 */
const MIN_SHARED_TOKENS = 2;
const MIN_LENGTH_RATIO = 0.4;
const hasEnoughSubstance = (shorter, longer) =>
  tokensOf(shorter).length >= MIN_SHARED_TOKENS &&
  longer.length > 0 &&
  shorter.length / longer.length >= MIN_LENGTH_RATIO;

/**
 * The stored clients of one hauler that look like they name the same entity as
 * `clientValue`, best first.
 *
 * Candidates only. Nothing here is applied on its own — the row stays blocked and
 * a person decides, because "these two names describe one client" is a judgement
 * about the world that a string comparison cannot make.
 */
/**
 * Tokens that DISTINGUISH one client from another rather than describing it.
 *
 * This is the guard that makes auto-applying a near miss safe, and it exists
 * because of what the live rosters actually contain. Measured across all 667
 * clients on this app's hauler rosters, these pairs are DIFFERENT clients:
 *
 *   "barangay 1"      vs "barangay 2" … "barangay 4" vs "barangay 5"   90.0%
 *   "brgy. 03 (rcb)"  vs "brgy. 04 (rcb)"                              92.9%
 *
 * Ten collisions among Baler's barangays alone. Names that differ by a single
 * digit are MAXIMALLY similar as strings and completely different places, so any
 * percentage threshold — 90 included — files Barangay 1's waste under Barangay 2.
 * That is why this module rejected similarity scoring in the first place (see the
 * note above), and a threshold alone would reintroduce exactly that.
 *
 * So the differing tokens are inspected instead: if what separates two names
 * carries a number or a short code, they are held apart no matter how similar the
 * strings are. A qualifier that is pure words ("corporation", "incorporated",
 * ", bulacan") describes the same entity and does not block the match.
 */
const IDENTIFIER_TOKEN = /\d/;

/** The tokens present in one normalized name and absent from the other. */
const differingTokens = (a, b) => {
  const aTokens = tokensOf(a);
  const bTokens = tokensOf(b);
  const inB = new Set(bTokens);
  const inA = new Set(aTokens);
  return [
    ...aTokens.filter((t) => !inB.has(t)),
    ...bTokens.filter((t) => !inA.has(t)),
  ];
};

/**
 * Do these two names differ only by DESCRIPTIVE words, never by an identifier?
 *
 * Exported for the auto-apply decision and pinned by tests — this predicate is
 * the whole safety argument.
 */
export const differsOnlyByQualifier = (a, b) => {
  const diff = differingTokens(normalizeComparableText(a), normalizeComparableText(b));
  if (diff.length === 0) return true;
  return !diff.some((token) => IDENTIFIER_TOKEN.test(token));
};

// A near miss is auto-applied only from the CONTAINMENT class — one name is the
// other plus a qualifier. The token-subset class (0.85, abbreviations) stays a
// suggestion: "corp"→"corporation" is usually right, but it is an inference about
// what an abbreviation stands for, and it is not worth a misattributed trip.
export const AUTO_ALIGN_MIN_SCORE = 0.95;

// ── Spelling slips: "Villa Muesta" for "Villa Muestra" ──
//
// Edit distance (optimal string alignment: insert, delete, substitute, swap two
// neighbours) between the two normalized names. Formatting never reaches here —
// normalizeComparableText has already made "Inc." and "Inc" equal — so what is
// left is a real difference in letters, and it is only ever a SUGGESTION: the
// score stays under AUTO_ALIGN_MIN_SCORE, so the operator confirms every one.
const editDistance = (a, b, max) => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrev = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prevPrev && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2] + 1);
      }
      row.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = row;
  }
  return prev[b.length];
};

// How many letters may differ for a name of this length: none for very short
// names (every letter of "ABC" matters), up to three for long ones
// ("Northwest Sample Haulers" / "Northwind Sample Haulers" is three). These are
// suggestions the operator confirms, so a little generosity costs one glance;
// numbers and codes are excluded above whatever the distance.
const typoAllowance = (length) => (length <= 4 ? 0 : length <= 9 ? 1 : length <= 19 ? 2 : 3);

/** A spelling-slip candidate for `target`, or null. Numbers and codes never qualify. */
const spellingNearMiss = (target, candidate, name, kind = "client") => {
  const allowance = typoAllowance(Math.max(target.length, candidate.length));
  if (!allowance) return null;
  // "Barangay 1" vs "Barangay 2" is one letter apart and two different places.
  if (differingTokens(target, candidate).some((token) => IDENTIFIER_TOKEN.test(token))) return null;
  const distance = editDistance(target, candidate, allowance);
  if (distance > allowance) return null;
  return {
    name,
    score: distance === 1 ? 0.8 : 0.7,
    reason:
      distance === 1
        ? `Differs by one letter — check the spelling of the ${kind}.`
        : `Differs by a few letters or a word — check that it is the same ${kind}.`,
  };
};

/** Containment, abbreviation or spelling near miss of `target` against one name. */
const nameNearMiss = (target, name, kind) => {
  const candidate = normalizeComparableText(name);
  if (!candidate || candidate === target) return null;

  // Direction matters: the SHORTER name is the one that has to be contained.
  const [shorter, longer] = target.length <= candidate.length ? [target, candidate] : [candidate, target];
  if (hasEnoughSubstance(shorter, longer)) {
    if (containsWholeWords(longer, shorter)) {
      return {
        name,
        score: 0.98,
        reason: `One name is the other with an extra qualifier — almost certainly the same ${kind}.`,
      };
    }
    if (tokenSubset(shorter, longer)) {
      return {
        name,
        score: 0.85,
        reason: `Every word of one name appears in the other — likely the same ${kind}, abbreviated differently.`,
      };
    }
  }
  return spellingNearMiss(target, candidate, name, kind);
};

export const findClientNearMisses = (hauler, clientValue, limit = 4) => {
  const target = normalizeComparableText(clientValue);
  if (!target || !hauler || hauler.ambiguous) return [];
  return haulerClientPool(hauler)
    .map((client) => nameNearMiss(target, clientDisplayName(client), "client"))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

/**
 * Accredited haulers whose name looks like `haulerValue` — for the "Did you
 * mean …?" in an unresolved row. Suggestions only; a hauler is never swapped
 * on the operator's behalf.
 */
export const findHaulerNearMisses = (haulers, haulerValue, limit = 3) => {
  const target = normalizeComparableText(haulerValue);
  if (!target) return [];
  const seen = new Set();
  return (haulers || [])
    .map((hauler) => haulerName(hauler))
    .filter((name) => {
      const key = normalizeComparableText(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((name) => nameNearMiss(target, name, "hauler"))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

/**
 * Resolve one row's raw Hauler / Client values to a baseline hauler and one of
 * its clients.
 *
 * Strategies are tried in DESCENDING order of certainty and the first that yields
 * exactly one answer wins. Every strategy resolves against records that already
 * exist on the baseline — none of them can conjure one.
 *
 * @returns {{
 *   status: "direct" | "aligned" | "ambiguous" | "unresolved",
 *   hauler?: string, client?: string,     // the baseline's own spelling
 *   method?: string, note?: string,       // what was done, in words
 *   candidates?: string[],                // for "ambiguous"
 *   reason?: string,                      // for "unresolved"
 * }}
 */
export const resolveDisposalIdentity = (row = {}, haulers = []) => {
  const rawHauler = cleanUploadText(row.hauler);
  const rawClient = cleanUploadText(row.client);

  // 0 — the file is already correct. Left first and untouched: a hand-made file
  // must behave exactly as it did before this module existed.
  //
  // This also covers the SELF-HAULING case with no special handling. A private
  // company that hauls its own waste appears in both columns under the same name,
  // and the baseline stores it as a hauler that lists itself as a client — so the
  // ordinary lookup matches, and nothing has to be inferred. (It only holds when
  // the hauler genuinely lists itself; if it does not, the row falls through to
  // the strategies below and is reported as a client that needs encoding, which
  // is the correct answer.)
  const direct = resolvedHauler(findUploadHauler(haulers, rawHauler));
  if (direct) {
    const client = findUploadClientForHauler(direct, rawClient);
    if (client && !client.ambiguous && !client.inactiveOnly) {
      return { status: "direct", hauler: haulerName(direct), client: clientDisplayName(client) };
    }
  }

  // 1 — a compound "HAULER - CLIENT" value. Both sides must land on the baseline:
  // the left on a hauler, the right on a client OF THAT HAULER. Tried against the
  // Hauler cell first, then the Client cell, because a gate export writes the same
  // compound into both and either may be the one carrying it.
  for (const source of [rawHauler, rawClient]) {
    const hits = [];
    splitCandidates(source).forEach(({ left, right }) => {
      [
        { h: left, c: right },
        // The reverse reading, for exports that write "CLIENT - HAULER".
        { h: right, c: left },
      ].forEach(({ h, c }) => {
        const hauler = resolvedHauler(findUploadHauler(haulers, h));
        if (!hauler) return;
        const client = findUploadClientForHauler(hauler, c);
        if (!client || client.ambiguous || client.inactiveOnly) return;
        const key = `${normalizeComparableText(haulerName(hauler))}|${normalizeComparableText(clientDisplayName(client))}`;
        if (!hits.some((hit) => hit.key === key)) {
          hits.push({ key, hauler: haulerName(hauler), client: clientDisplayName(client) });
        }
      });
    });
    if (hits.length === 1) {
      return {
        status: "aligned",
        hauler: hits[0].hauler,
        client: hits[0].client,
        method: "compound-split",
        note: `"${source}" was read as hauler "${hits[0].hauler}" serving client "${hits[0].client}".`,
      };
    }
    if (hits.length > 1) {
      return {
        status: "ambiguous",
        method: "compound-split",
        candidates: hits.map((hit) => `${hit.hauler} → ${hit.client}`),
        reason: `"${source}" can be read as more than one hauler/client pair.`,
      };
    }
  }

  // 2 — the value is a CLIENT name and the hauler was never stated. Usable only
  // when exactly one accredited hauler lists that client: with two, attributing
  // the trip would be a coin flip between two haulers' volumes.
  for (const source of [rawClient, rawHauler]) {
    const serving = haulersServingClient(haulers, source);
    if (serving.length === 1) {
      return {
        status: "aligned",
        hauler: haulerName(serving[0].hauler),
        client: clientDisplayName(serving[0].client),
        method: "client-only",
        note: `"${source}" is a client of ${haulerName(serving[0].hauler)} — the only accredited hauler assigned to it.`,
      };
    }
    if (serving.length > 1) {
      return {
        status: "ambiguous",
        method: "client-only",
        candidates: serving.map((hit) => `${haulerName(hit.hauler)} → ${clientDisplayName(hit.client)}`),
        reason: `"${source}" is a client of ${serving.length} accredited haulers, so the hauler cannot be inferred from the file.`,
      };
    }
  }

  // 3 — nothing resolved. Say which half is missing, because "add the client to
  // the hauler" and "the hauler is not accredited here" are different jobs.
  if (direct) {
    const pool = haulerClientPool(direct).map(clientDisplayName).filter(Boolean);
    // A near miss changes the diagnosis: this is not a client the baseline is
    // missing, it is one spelled two ways. Reported as a MISMATCH so the preview
    // can offer the fix instead of sending the operator off to add a duplicate.
    const suggestions = findClientNearMisses(direct, rawClient);
    // ── Auto-adopt the stored spelling when it cannot be the wrong client ──────
    //
    // The operator's ask: stop blocking a row when the only difference is how the
    // client is spelled, and just use the stored name. Applied only when ALL of
    // these hold, because each one rules out a way of getting it wrong:
    //
    //   • exactly ONE candidate reaches the containment class (≥0.95) — two
    //     equally good candidates is a choice, not a correction;
    //   • no OTHER candidate is anywhere near it, so there is nothing to weigh;
    //   • the names differ only by descriptive words, never by a number or code
    //     (see differsOnlyByQualifier — this is what keeps Barangay 1 and
    //     Barangay 2 apart, and no percentage threshold can do it).
    //
    // Anything short of that stays a MISMATCH for a person to resolve, exactly as
    // before. The row records what was adopted, so the preview shows it and it is
    // never a silent rewrite.
    const strong = suggestions.filter((s) => s.score >= AUTO_ALIGN_MIN_SCORE);
    if (
      strong.length === 1 &&
      suggestions.filter((s) => s !== strong[0]).every((s) => s.score < AUTO_ALIGN_MIN_SCORE) &&
      differsOnlyByQualifier(rawClient, strong[0].name)
    ) {
      return {
        status: "aligned",
        method: "client-spelling",
        hauler: haulerName(direct),
        client: strong[0].name,
        note:
          `Client "${rawClient}" was recorded as "${strong[0].name}" on the baseline — ` +
          "the stored spelling was used. The two names differ only by a qualifier.",
      };
    }
    if (suggestions.length) {
      return {
        status: "mismatch",
        hauler: haulerName(direct),
        client: rawClient,
        suggestions,
        reason:
          `Hauler "${haulerName(direct)}" is accredited, but "${rawClient}" does not exactly match any of its ` +
          `${pool.length} client(s). ${suggestions.length === 1 ? "One looks" : `${suggestions.length} look`} like the same client spelled differently.`,
      };
    }
    return {
      status: "unresolved",
      hauler: haulerName(direct),
      client: rawClient,
      reason:
        `Hauler "${haulerName(direct)}" is accredited, but "${rawClient}" is not one of its clients` +
        (pool.length
          ? ` (it currently has ${pool.length}: ${pool.slice(0, 5).join(", ")}${pool.length > 5 ? ", …" : ""}).`
          : " — this hauler has no clients on the baseline yet."),
    };
  }
  // A hauler spelled slightly differently from an accredited one is most likely
  // that hauler — say which, so the operator can correct the cell. Never swapped
  // automatically: whose waste a trip is, is the operator's call.
  const haulerSuggestions = findHaulerNearMisses(haulers, rawHauler);
  if (haulerSuggestions.length) {
    return {
      status: "unresolved",
      client: rawClient,
      haulerSuggestions,
      reason:
        `Hauler "${rawHauler}" is not accredited under this SLF. ` +
        `Did you mean "${haulerSuggestions[0].name}"?` +
        (haulerSuggestions.length > 1 ? ` (Also close: ${haulerSuggestions.slice(1).map((s) => `"${s.name}"`).join(", ")}.)` : ""),
    };
  }
  return {
    status: "unresolved",
    reason: `Neither "${rawHauler}" nor "${rawClient}" matches an accredited hauler or a client of one under this SLF.`,
  };
};

/**
 * Apply resolution to a parsed row.
 *
 * Returns a NEW row: `hauler` / `client` rewritten to the baseline's spelling when
 * alignment succeeded, `_alignment` describing what happened, and `_errors`
 * carrying an actionable message when it did not. The caller runs its normal
 * validation afterwards — on a successfully aligned row that validation now sees
 * canonical names and passes, which is precisely the point.
 */
export const alignDisposalRow = (row = {}, haulers = []) => {
  const rowLabel = row._rowNumber ? `Row ${row._rowNumber}` : "Row";
  const result = resolveDisposalIdentity(row, haulers);

  if (result.status === "direct") {
    return { ...row, _alignment: null, _alignmentErrors: [] };
  }
  if (result.status === "aligned") {
    return {
      ...row,
      hauler: result.hauler,
      client: result.client,
      _alignment: {
        status: "aligned",
        method: result.method,
        note: result.note,
        originalHauler: cleanUploadText(row.hauler),
        originalClient: cleanUploadText(row.client),
      },
      _alignmentErrors: [],
    };
  }
  if (result.status === "ambiguous") {
    return {
      ...row,
      _alignment: { status: "ambiguous", method: result.method, note: result.reason },
      _alignmentErrors: [
        `${rowLabel} — ${result.reason} Candidates: ${(result.candidates || []).join("; ")}. ` +
          "Correct the Hauler and Client values in the preview, or encode the intended pairing in Baseline / Accredited Haulers.",
      ],
    };
  }
  if (result.status === "mismatch") {
    const best = result.suggestions[0];
    return {
      ...row,
      _alignment: {
        status: "mismatch",
        note: result.reason,
        hauler: result.hauler,
        client: result.client,
        suggestions: result.suggestions,
      },
      // Still an error — the row cannot import as it stands — but one that names
      // the fix rather than sending the operator to add a client that is already
      // there under another spelling.
      _alignmentErrors: [
        `${rowLabel} — ${result.reason} Closest: "${best.name}". ` +
          "Resolve it above: use the stored name for this file, or correct the client on the hauler.",
      ],
    };
  }
  return {
    ...row,
    _alignment: {
      status: "unresolved",
      note: result.reason,
      hauler: result.hauler || "",
      client: result.client || cleanUploadText(row.client),
      suggestions: [],
      haulerSuggestions: result.haulerSuggestions || [],
    },
    _alignmentErrors: [
      result.haulerSuggestions?.length
        ? `${rowLabel} — ${result.reason} If so, correct the Hauler cell in the preview; if it is a different hauler, add it under Baseline / Accredited Haulers.`
        : `${rowLabel} — ${result.reason} Add the missing record under Baseline / Accredited Haulers, then re-upload.`,
    ],
  };
};

/**
 * What the whole file did, for the preview banner and for VERA.
 *
 * Two actionable lists, because they are two different jobs:
 *
 *   mismatches   — the baseline HAS this client, spelled differently. Fixed by
 *                  agreeing on one spelling, and each entry carries the candidates
 *                  and the rows affected so one decision settles all of them.
 *   needsEncoding — the baseline genuinely does not have this record. Fixed by
 *                  adding it.
 *
 * Both are de-duplicated across rows, so a name repeated on forty trips is one
 * item of work rather than forty.
 */
export const summarizeAlignment = (rows = []) => {
  const aligned = [];
  const ambiguous = [];
  const mismatches = new Map();
  const needsEncoding = new Map();
  const byMethod = new Map();

  (rows || []).forEach((row) => {
    const alignment = row?._alignment;
    if (!alignment) return;
    if (alignment.status === "aligned") {
      aligned.push(row);
      byMethod.set(alignment.method, (byMethod.get(alignment.method) || 0) + 1);
      return;
    }
    if (alignment.status === "ambiguous") {
      ambiguous.push(row);
      return;
    }
    // A row that describes no trip cannot be evidence of a missing or misspelled
    // client — see isTripRow. Its errors still stand; it just contributes no work
    // item.
    if (!isTripRow(row)) return;

    if (alignment.status === "mismatch") {
      // Keyed on the PAIR: the same client text under two different haulers is
      // two decisions, and merging them would apply one hauler's fix to the other.
      const key = `${normalizeComparableText(alignment.hauler)}|${normalizeComparableText(alignment.client)}`;
      const entry = mismatches.get(key) || {
        key,
        hauler: alignment.hauler,
        client: alignment.client,
        suggestions: alignment.suggestions || [],
        reason: alignment.note || "",
        rows: 0,
        rowKeys: [],
      };
      entry.rows += 1;
      if (row.key != null) entry.rowKeys.push(row.key);
      mismatches.set(key, entry);
      return;
    }

    const label = [cleanUploadText(row.hauler), cleanUploadText(row.client)]
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .join(" / ");
    if (!label) return;
    const entry = needsEncoding.get(label) || {
      label,
      hauler: alignment.hauler || "",
      client: alignment.client || "",
      rows: 0,
      rowKeys: [],
      reason: alignment.note || "",
      // "Did you mean" accredited haulers for a hauler the baseline lacks.
      haulerSuggestions: alignment.haulerSuggestions || [],
    };
    entry.rows += 1;
    if (row.key != null) entry.rowKeys.push(row.key);
    needsEncoding.set(label, entry);
  });

  return {
    total: (rows || []).length,
    alignedCount: aligned.length,
    ambiguousCount: ambiguous.length,
    mismatchCount: [...mismatches.values()].reduce((sum, entry) => sum + entry.rows, 0),
    methods: [...byMethod.entries()].map(([method, count]) => ({ method, count })),
    mismatches: [...mismatches.values()].sort((a, b) => b.rows - a.rows),
    needsEncoding: [...needsEncoding.values()].sort((a, b) => b.rows - a.rows),
  };
};

export default {
  detectSystemGeneratedFile,
  resolveDisposalIdentity,
  alignDisposalRow,
  summarizeAlignment,
  findClientNearMisses,
  findHaulerNearMisses,
  differsOnlyByQualifier,
  AUTO_ALIGN_MIN_SCORE,
  isTripRow,
};
