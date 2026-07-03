const DataSLF = require("../models/DataSLF");
const SlfFacility = require("../models/SlfFacility");
const UserPortal = require("../models/UserPortal");
const PortalSubmissionQueue = require("../models/PortalSubmissionQueue");
const { writeLog } = require("./logger");

// One-time, idempotent data cleanup: several records refer to the SAME Bataan
// site under different names:
//   • "Bataan Engineered Sanitary Landfill Facility (BESLF) (Private)"  ← target
//   • "Bataan Engineered Sanitary Landfill"                              ← merge
//   • "Bataan Integrated Waste Management Facility"                      ← merge
// Everything (data, submissions and incoming/queued portal submissions) is
// merged into the canonical BESLF name and the leftover facility record(s) are
// soft-deleted. Once merged, no source records remain, so subsequent runs are a
// no-op.
function norm(value) {
  return String(value || "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Does this name refer to the Bataan SLF site (under any of its aliases)?
function isBataanSlfName(value) {
  const raw = String(value || "").toLowerCase();
  if (!raw.includes("bataan")) return false;
  return (
    raw.includes("engineered sanitary landfill") ||
    raw.includes("beslf") ||
    raw.includes("integrated waste management")
  );
}

const buildDisplayName = (lgu, ownership) =>
  `${lgu || ""}${ownership ? " (" + ownership + ")" : ""}`.trim();

async function mergeBataanSlf() {
  // Gather candidate names from both the disposal data and the queued (incoming)
  // portal submissions so aliases that only exist in one collection are caught.
  const [dataNames, queueNames] = await Promise.all([
    DataSLF.distinct("slfName", { slfName: { $ne: null, $ne: "" } }),
    PortalSubmissionQueue.distinct("slfName", { slfName: { $ne: null, $ne: "" } }),
  ]);
  const allNames = [...new Set([...dataNames, ...queueNames].filter(Boolean))];
  const bataanNames = allNames.filter(isBataanSlfName);
  if (bataanNames.length < 2) return; // nothing to merge

  // Target = the canonical BESLF name. Prefer the explicit "(BESLF)" label, then
  // the "(Private)" variant, then any "engineered sanitary landfill" name.
  const rawLower = (n) => String(n || "").toLowerCase();
  const targetName =
    bataanNames.find((n) => rawLower(n).includes("beslf")) ||
    bataanNames.find((n) => rawLower(n).includes("(private)")) ||
    bataanNames.find((n) => rawLower(n).includes("engineered sanitary landfill"));
  if (!targetName) return;

  const sourceNames = bataanNames.filter((n) => n !== targetName);
  if (sourceNames.length === 0) return;

  // Resolve the target facility id so reassigned records link to BESLF.
  let facilityId = null;
  const targetDoc = await DataSLF.findOne({
    slfName: targetName,
    slfGenerator: { $ne: null },
  })
    .select("slfGenerator")
    .lean();
  facilityId = targetDoc?.slfGenerator || null;
  if (!facilityId) {
    const targetKey = norm(targetName);
    const facs = await SlfFacility.find({ deletedAt: null })
      .select("_id lgu ownership")
      .lean();
    const match = facs.find(
      (f) => norm(buildDisplayName(f.lgu, f.ownership)) === targetKey,
    );
    facilityId = match?._id || null;
  }

  const set = { slfName: targetName };
  if (facilityId) set.slfGenerator = facilityId;

  // 1) Disposal data + submissions.
  const dataResult = await DataSLF.updateMany(
    { slfName: { $in: sourceNames } },
    { $set: set },
  );

  // 2) Incoming / queued portal submissions (drafts & scheduled).
  let queueModified = 0;
  try {
    const queueResult = await PortalSubmissionQueue.updateMany(
      { slfName: { $in: sourceNames } },
      { $set: set },
    );
    queueModified = queueResult.modifiedCount || 0;
  } catch { /* best-effort */ }

  if ((dataResult.modifiedCount || 0) === 0 && queueModified === 0) return;

  // 3) Re-label portal user facility assignments that used a source name.
  try {
    await UserPortal.updateMany(
      { assignedSlfName: { $in: sourceNames } },
      { $set: { "assignedSlfName.$[elem]": targetName } },
      { arrayFilters: [{ elem: { $in: sourceNames } }] },
    );
  } catch { /* best-effort */ }

  // 4) Soft-delete the leftover source facility record(s) — never the target.
  let archived = 0;
  try {
    const sourceSet = new Set(sourceNames.map(norm));
    const candidates = await SlfFacility.find({ deletedAt: null }).select("_id lgu ownership");
    const ids = candidates
      .filter(
        (f) =>
          String(f._id) !== String(facilityId) &&
          sourceSet.has(norm(buildDisplayName(f.lgu, f.ownership))),
      )
      .map((f) => f._id);
    if (ids.length) {
      const r = await SlfFacility.updateMany(
        { _id: { $in: ids } },
        { $set: { deletedAt: new Date(), deletedBy: "startup-merge" } },
      );
      archived = r.modifiedCount || ids.length;
    }
  } catch { /* best-effort */ }

  console.log(
    `[merge] Bataan SLF merged: ${dataResult.modifiedCount} record(s) + ${queueModified} queued submission(s) → "${targetName}", ${archived} facility record(s) archived.`,
  );
  writeLog("warn", "slf.merge.startup", {
    message: `Startup merge: [${sourceNames.join(", ")}] → "${targetName}" (${dataResult.modifiedCount} records, ${queueModified} queued, ${archived} facility archived)`,
    meta: {
      sourceNames,
      targetName,
      affected: dataResult.modifiedCount,
      queued: queueModified,
      archived,
    },
  });
}

module.exports = { mergeBataanSlf };
