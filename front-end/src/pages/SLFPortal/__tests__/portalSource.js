/**
 * The SLF Portal container's source as ONE string, for the source-level guards
 * in this folder.
 *
 * index.jsx used to hold everything. It is now a thin container that calls
 * hooks in ./hooks/ and renders components such as DataEntryTab, so a rule a
 * test pins down ("VERA is never run from an effect", "the dirty guard is
 * consulted before a reload") may live in one of those files. This splices
 * each extracted module back in at the line that uses it — recursively, so a
 * component DataEntryTab renders lands inside DataEntryTab's text — which keeps
 * the order the code had before the split. Tests that slice from one needle to
 * the next, or assert that one thing comes before another, keep meaning what
 * they meant.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

// Components and builders split out of index.jsx (besides everything in hooks/).
const SPLIT_SIBLINGS = new Set([
  "portalShared",
  "PortalHeader",
  "PortalNoticeBanners",
  "CellOrganizerModal",
  "DataEntryTab",
  "DataEntryGuide",
  "ActiveCellsTable",
  "ClosedCellsTable",
  "HaulersBaselineCard",
  "buildPortalMenus",
  "PortalOverlays",
]);

function resolveFile(fromDir, spec) {
  const base = path.resolve(fromDir, spec);
  for (const ext of ["", ".jsx", ".js"]) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

function isSplitModule(file) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (rel.startsWith("hooks/")) return true;
  return SPLIT_SIBLINGS.has(rel.replace(/\.(jsx?|js)$/, ""));
}

function expand(file, seen) {
  seen.add(file);
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  const dir = path.dirname(file);
  const firstCode = lines.findIndex((l) => /^export (default )?function /.test(l));
  const inserts = new Map(); // line index -> [source, ...]

  for (const m of text.matchAll(/^import (?:(\w+)|\{([^}]*)\}) from "(\.{1,2}\/[^"]+)";$/gm)) {
    const target = resolveFile(dir, m[3]);
    if (!target || seen.has(target) || !isSplitModule(target)) continue;
    const names = m[1] ? [m[1]] : m[2].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean);
    const use = new RegExp(`\\b(${names.join("|")})\\(|<(${names.join("|")})\\b|\\b(${names.join("|")})\\b`);
    let at = lines.findIndex((l, i) => i > firstCode && !l.startsWith("import ") && use.test(l));
    if (at === -1) at = Math.max(firstCode, 0);
    if (!inserts.has(at)) inserts.set(at, []);
    inserts.get(at).push(expand(target, seen));
  }

  const out = [];
  lines.forEach((l, i) => {
    if (inserts.has(i)) out.push(...inserts.get(i));
    out.push(l);
  });
  return out.join("\n");
}

let cached = null;

export function portalSource() {
  if (!cached) cached = expand(path.join(root, "index.jsx"), new Set());
  return cached;
}

export default portalSource;
