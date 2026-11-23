/**
 * Portal announcement — SLF Portal updates, 24 November 2026 (release 1.9.x).
 *
 * Written for PORTAL USERS (SLF operators, MENRO/CENRO officers, PCOs). Only
 * what changes for them in the portal. Admin-side work in the same release —
 * the SLF Table View/Edit formula labels, Cell Infrastructure colours, the
 * Baseline Data MOV view — is left out: portal users cannot see it.
 *
 * Previews by default; publishes only with --apply (outward-facing — same
 * convention as seedPortalUpdatesNov2026.js). It does NOT send the email; that
 * stays a separate, deliberate action in Developer Settings.
 *
 * The announcement has an end date, so it leaves the login page by itself.
 * Publishing it makes it the ONE active announcement (the 1.7.0 one ends on
 * 24 Nov 2026 anyway).
 *
 * Usage
 * -----
 *   node seeds/seedPortalUpdatesNov2026b.js            # preview, writes nothing
 *   node seeds/seedPortalUpdatesNov2026b.js --apply    # publish (AFTER deploying)
 */
const mongoose = require("mongoose");
require("dotenv").config();

const AppSettings = require("../models/AppSettings");
const { connectMongo } = require("../config/mongo");

const APPLY = process.argv.includes("--apply");
const MONGODB_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",").map((v) => v.trim()).filter(Boolean);

const ANNOUNCEMENT_TITLE = "SLF Portal Updates - November 24, 2026";

const ANNOUNCEMENT_MESSAGE = [
  "The following SLF Portal improvements are now live:",
  "",
  "DATA ENTRY - BASELINE",
  "• Active Cells, Closed Cells and Accredited Haulers are now cards. Click a card's title to fold or unfold it; the portal remembers how you left them.",
  "• Each of these cards has an Upload MOV button at the right of its title, for your Means of Verification (PDF, Word, Excel or photos, up to 25 MB each). Save the baseline to keep them.",
  "• Closed cells now record the Date Closed / Completed / Used.",
  "• Cell volumes always use the unit EMB Region III declared for each cell. Entries saved earlier in another unit were converted to it — the amount of waste is the same.",
  "• The Unit of Measurement is now set by EMB Region III for your facility, so the portal and EMB always show the same unit.",
  "",
  "CELL CAPACITY",
  "• Waste in Cell is your baseline plus your APPROVED submissions. Submissions still pending review are not yet in the cell, but they already reserve its space, so a cell cannot be overfilled while they wait. Reverted entries are not counted until they are resubmitted and approved.",
  "",
  "DRAFTS & SCHEDULED",
  "• Drafts and scheduled submissions can now be edited — use the Edit button on the row or in the View window. A scheduled submission keeps its time; Save as Draft unschedules it.",
  "• The list now always shows your latest drafts, so Edit no longer fails on a draft that was already submitted.",
  "",
  "SUBMISSION HISTORY AND REPORT",
  "• Generate Report: choose a month and Whole month, 1st–15th or 16th–end, or any custom dates. The report now lists every day's submissions, scrolls inside its window, and uses your facility's unit.",
  "• The Submission History table now shows Company / Type together, and Status / Remarks together.",
  "",
  "MY REQUESTS",
  "• A new Reason / Statement column shows what you asked for. Opening a request shows only that request's conversation, one message at a time.",
  "",
  "DASHBOARD",
  "• Permits show the DP type, the status EMB recorded, and older renewals marked as expired. Facility details refresh on their own when EMB updates them.",
  "• Your Hazardous Waste Generator ID is now shown.",
  "",
  "YOUR PROFILE",
  "• To change your profile picture, open View Profile and click the camera button on your avatar.",
  "",
  "TABLETS AND PHONES",
  "• The portal works better on tablets such as the iPad: tables scroll sideways instead of squeezing, and you can zoom in and out.",
  "",
  "If anything does not look right for your facility, please report it through Support so EMB Region III can check it against your records.",
].join("\n");

function buildAnnouncementPayload() {
  return {
    enabled: true,
    type: "info",
    priority: "normal",
    title: ANNOUNCEMENT_TITLE,
    summary: "Baseline cards with MOV upload, Waste in Cell from approved submissions, editable drafts, a report with date filters, and clearer requests and permits.",
    message: ANNOUNCEMENT_MESSAGE,
    // 24 Nov 2026 00:00 to 8 Dec 2026 23:59, Philippine time (UTC+8).
    startAt: new Date("2026-11-23T16:00:00.000Z"),
    endAt: new Date("2026-12-08T15:59:59.000Z"),
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
    console.log(`Window   : ${payload.startAt.toISOString()} -> ${payload.endAt.toISOString()}`);
    console.log(`Shown    : on login=${payload.showOnLogin}, in portal=${payload.showInPortal}, dismissible=${payload.dismissible}`);
    console.log(`Summary  : ${payload.summary}`);
    console.log("\n--- message as portal users will read it ---\n");
    console.log(payload.message);
    console.log("\n-------------------------------------------\n");
    console.log("Run again with --apply to publish. No email is sent by this script.\n");
    return;
  }

  await connectMongo(process.env.MONGODB_URI, { dnsServers: MONGODB_DNS_SERVERS });

  let settings = await AppSettings.findOne();
  if (!settings) settings = new AppSettings();

  let item = (settings.portalAnnouncements || []).find((a) => a.title === ANNOUNCEMENT_TITLE);

  // Only one announcement is active at a time.
  settings.portalAnnouncements.forEach((a) => { a.enabled = false; });

  let created = false;
  if (!item) {
    settings.portalAnnouncements.push(payload);
    item = settings.portalAnnouncements[settings.portalAnnouncements.length - 1];
    item.createdBy = "release 1.9 seed";
    created = true;
  } else {
    Object.assign(item, payload);
  }

  // The flat copy the login page reads (GET /settings/app also re-derives it).
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
  console.log("It is now the active announcement for portal users (no email sent).");
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Failed:", error.message);
  try { await mongoose.disconnect(); } catch { /* already closed */ }
  process.exit(1);
});
