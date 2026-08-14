/**
 * Portal announcement — SLF Portal updates, 14 August 2026.
 *
 * Written for PORTAL USERS (SLF operators, MENRO/CENRO officers, PCOs). It covers
 * only what changes for them in the portal. Admin-side work from the same release
 * — System & Logs paging/export/backup, VERA log detection, the admin submissions
 * views — is deliberately excluded: portal users cannot see any of it, and listing
 * it would only make the notice harder to read.
 *
 * ── Why this one asks for --apply ──────────────────────────────────────────
 * The other seeds in this folder publish on run. This announcement is different
 * in one way that matters: it is OUTWARD-FACING. Publishing it makes a banner
 * appear for every portal account and (with showOnLogin) an email subject line
 * ready to send. If it fires before the release is actually deployed, operators
 * are told about behaviour their portal does not have yet.
 *
 * So it previews by default and follows the `--apply` convention already used by
 * scripts/backfillBaselineCellIndex.js and scripts/clearBaselineSubmissionIds.js.
 *
 * Usage
 * -----
 *   node seeds/seedPortalUpdatesAug2026.js            # preview, writes nothing
 *   node seeds/seedPortalUpdatesAug2026.js --apply    # publish (AFTER deploying)
 */
const mongoose = require("mongoose");
require("dotenv").config();

const AppSettings = require("../models/AppSettings");
const { connectMongo } = require("../config/mongo");

const APPLY = process.argv.includes("--apply");
const MONGODB_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",").map((v) => v.trim()).filter(Boolean);

const ANNOUNCEMENT_TITLE = "SLF Portal Updates - August 14, 2026";

const ANNOUNCEMENT_MESSAGE = [
  "The following SLF Portal improvements are now live:",
  "",
  "DATA ENTRY - BASELINE DATA",
  "• Your baseline now shows the cell names exactly as EMB Region III has them recorded for your facility. Previously a cell could appear under a generic label such as \"Cell 1\" even when your facility's cell is recorded under a different name, so the Portal and EMB appeared to disagree. Your recorded volumes were never affected - only the label shown beside them.",
  "• Each cell entry is now permanently linked to the specific cell it belongs to, so the correct name continues to show even if a cell is renamed later.",
  "• A small number of older cell entries could not be matched automatically to a cell. These are kept exactly as you entered them and are being reviewed with EMB Region III. If you see a cell entry that does not look linked to one of your cells, please raise it through Support so it can be mapped correctly.",
  "",
  "DATA ENTRY - LOADING",
  "• Data Entry now opens noticeably faster. Facilities with a large number of accredited haulers - which previously could fail to open at all - now load normally.",
  "",
  "SAVING YOUR BASELINE",
  "• Saving your Baseline Data now locks it, as intended. Once locked, the baseline cannot be changed until you submit a Baseline Update Request and EMB Region III approves it. If you try to save a locked baseline, the Portal will now clearly tell you it is locked instead of appearing to save.",
  "• This protects your approved figures from being changed accidentally. Your existing values are never altered by a blocked save.",
  "",
  "DASHBOARD",
  "• The \"Submitted Vol.\" figure on your Portal dashboard now shows the total volume you have actually submitted through the Portal. Previously this tile could show zero, or a figure that did not match your submissions. Nothing about your submitted records changed - only the figure being displayed.",
  "• Your dashboard totals refresh right after you submit, so what you see reflects what you just sent.",
  "",
  "GENERAL",
  "• Portal pages load faster across the Dashboard, Data Entry and Submission History.",
  "• Side panels and detail screens now display correctly on mobile phones and tablets, without content running off the edge of the screen.",
  "",
  "If anything does not look right for your facility - particularly a cell name or a baseline figure - please report it through Support so EMB Region III can check it against your records.",
].join("\n");

function buildAnnouncementPayload() {
  return {
    enabled: true,
    type: "info",
    priority: "normal",
    title: ANNOUNCEMENT_TITLE,
    summary: "Correct cell names in Baseline Data, faster Data Entry, accurate Submitted Vol., and baseline locking after save.",
    message: ANNOUNCEMENT_MESSAGE,
    startAt: new Date("2026-08-14T00:00:00.000Z"),
    endAt: null,
    showOnLogin: true,
    showInPortal: true,
    dismissible: true,
    emailSubject: ANNOUNCEMENT_TITLE,
    emailMessage: ANNOUNCEMENT_MESSAGE,
  };
}

async function run() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set.");

  const payload = buildAnnouncementPayload();

  if (!APPLY) {
    console.log("\nPREVIEW - nothing was written.\n");
    console.log(`Title    : ${payload.title}`);
    console.log(`Type     : ${payload.type} (priority: ${payload.priority})`);
    console.log(`Starts   : ${payload.startAt.toISOString()}`);
    console.log(`Shown    : on login=${payload.showOnLogin}, in portal=${payload.showInPortal}, dismissible=${payload.dismissible}`);
    console.log(`Summary  : ${payload.summary}`);
    console.log("\n--- message as portal users will read it ---\n");
    console.log(payload.message);
    console.log("\n-------------------------------------------\n");
    console.log("Publishing this turns on a banner for EVERY portal account and");
    console.log("disables any currently-active announcement.");
    console.log("Run again with --apply AFTER the release is deployed.\n");
    return;
  }

  await connectMongo(process.env.MONGODB_URI, { dnsServers: MONGODB_DNS_SERVERS });

  let settings = await AppSettings.findOne();
  if (!settings) settings = new AppSettings();

  let item = (settings.portalAnnouncements || []).find(
    (announcement) => announcement.title === ANNOUNCEMENT_TITLE,
  );

  // Only one announcement is active at a time — same rule the previous seed uses.
  settings.portalAnnouncements.forEach((announcement) => {
    announcement.enabled = false;
  });

  let created = false;
  if (!item) {
    settings.portalAnnouncements.push(payload);
    item = settings.portalAnnouncements[settings.portalAnnouncements.length - 1];
    created = true;
  } else {
    Object.assign(item, payload);
  }

  settings.portalAnnouncementActiveId = item._id;
  settings.portalAnnouncementEnabled = true;
  settings.portalAnnouncementType = payload.type;
  settings.portalAnnouncementTitle = payload.title;
  settings.portalAnnouncementMessage = payload.message;
  settings.portalAnnouncementStartAt = payload.startAt;
  settings.portalAnnouncementEndAt = payload.endAt;
  settings.portalAnnouncementShowOnLogin = payload.showOnLogin;
  settings.portalAnnouncementShowInPortal = payload.showInPortal;
  settings.portalAnnouncementDismissible = payload.dismissible;
  settings.portalAnnouncementCtaLabel = "";
  settings.portalAnnouncementCtaUrl = "";

  await settings.save();
  console.log(`${created ? "Created" : "Updated"} portal announcement: ${ANNOUNCEMENT_TITLE}`);
  console.log("It is now the active announcement for portal users.");
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Failed:", error.message);
  try { await mongoose.disconnect(); } catch { /* already closed */ }
  process.exit(1);
});
