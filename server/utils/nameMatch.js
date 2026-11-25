// ── Comparing hauler names, client names and addresses ──
//
// Two spellings of the SAME name must compare equal; two DIFFERENT names must
// not. What is ignored is formatting, never content:
//
//   ignored   capital letters, periods, commas, semicolons, dashes, extra or
//             missing spaces around them, and dotted initials ("J.P." = "JP")
//   kept      every letter and every word, and their order
//
//   "Northgate Sample Logistics, Inc"  = "Northgate Sample Logistics Inc."
//   "NORTHWIND SAMPLE HAULERS"         = "Northwind Sample Haulers"
//   "Brgy.  Poblacion,Villa Muestra"   = "Brgy. Poblacion, Villa Muestra"
//   "Northwest Sample Haulers"        != "Northwind Sample Haulers"
//
// MUST stay behaviourally identical to normalizeComparableText in
// front-end/src/pages/SLFPortal/uploadHelpers.js — the upload preview uses that
// one to tell the operator what the server will decide. Both are pinned by the
// same table of cases (tests/nameMatch.test.js and the front-end's
// __tests__/nameMatch.test.js).

function comparableText(value) {
  return (
    String(value ?? "")
      .normalize("NFKC")
      // Zero-width characters survive a trim and are invisible on screen.
      .replace(/[​-‍⁠﻿]/g, "")
      // Smart quotes and unicode dashes, courtesy of Excel autocorrect.
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[‐-―]/g, "-")
      // Periods, commas, semicolons and dashes are punctuation, not identity:
      // each folds to a space ("Brgy.Poblacion" = "Brgy. Poblacion").
      .replace(/[.,;-]+/g, " ")
      .replace(/\s*\/\s*/g, "/")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      // Dotted initials: "j p rizal" (from "J.P. Rizal") = "jp rizal".
      // Letters only — "1.2" stays "1 2", so numbers keep their meaning.
      .replace(/\b([a-z]) (?=[a-z]\b)/g, "$1")
  );
}

/** Same name, ignoring formatting? */
function sameName(a, b) {
  const x = comparableText(a);
  return x !== "" && x === comparableText(b);
}

module.exports = { comparableText, sameName };
