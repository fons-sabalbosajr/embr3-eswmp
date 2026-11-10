/**
 * Portal announcement — SLF Portal updates, 10 November 2026 (release 1.7.0).
 *
 * Written for PORTAL USERS (SLF operators, MENRO/CENRO officers, PCOs). Only
 * what changes for them in the portal. Admin-side work in the same release —
 * Generate Reports, the Reporting Summary, VERA's settings screen, the AI
 * provider fix — is left out: portal users cannot see it.
 *
 * Previews by default; publishes only with --apply (outward-facing — see
 * seedPortalUpdatesAug2026.js for the convention). It does NOT send the email;
 * that stays a separate, deliberate action in Developer Settings.
 *
 * The announcement has an end date, so it leaves the login page by itself.
 *
 * Usage
 * -----
 *   node seeds/seedPortalUpdatesNov2026.js            # preview, writes nothing
 *   node seeds/seedPortalUpdatesNov2026.js --apply    # publish (AFTER deploying)
 */
const mongoose = require("mongoose");
require("dotenv").config();

const AppSettings = require("../models/AppSettings");
const { connectMongo } = require("../config/mongo");

const APPLY = process.argv.includes("--apply");
const MONGODB_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",").map((v) => v.trim()).filter(Boolean);

const ANNOUNCEMENT_TITLE = "SLF Portal Updates - November 10, 2026";

const ANNOUNCEMENT_MESSAGE = [
  "The following SLF Portal improvements are now live:",
  "",
  "YOUR PROFILE",
  "• You can now add a profile picture. Open your name at the top right, choose View Profile, then click the camera button on your avatar. You can zoom and position the photo before saving it, change it at any time, or remove it.",
  "",
  "DATA ENTRY - ADDING A TRANSPORT ENTRY",
  "• Add Transport Entry is now step by step: Trip → Vehicles & Waste → Review. You can click any step or use Back and Next. If something is missing when you save, that step turns red and the form opens on it so you can see what to fix.",
  "• When editing a saved entry, Update Entry is available on every step.",
  "",
  "CORRECTIONS AND DRAFTS",
  "• When you correct a reverted entry, you can now Save as Draft or Schedule it. Finishing it later resubmits the same entry (same ID No., back to Pending) instead of creating a new submission.",
  "• In Drafts & Scheduled, a saved correction is labelled \"Correction of SLF-…\". If you already resubmitted that entry from Data Entry, the older copy is cancelled automatically so it can never overwrite your newer correction.",
  "• Drafts can now be opened again with Edit in Data Entry, so a draft that could not be submitted can be fixed instead of deleted.",
  "• Submissions for a facility marked non-operational are no longer accepted, including from Drafts and scheduled submissions.",
  "",
  "MY REQUESTS",
  "• The status of each request now comes from EMB Region III's actual answer to it, using the same labels the reviewers use (for example Edit Approved, Reverted, Update Approved, Baseline Locked, Resolved). Requests that had already been answered but still showed Pending now show their real status.",
  "",
  "SUBMISSION HISTORY AND OVERVIEW",
  "• The tables in Submission Details now fit the window - long values wrap instead of scrolling sideways.",
  "• Generate Report keeps itself up to date while it is open: approvals, reverts and new submissions appear on their own, with the time of the last update.",
  "• When EMB Region III approves a resubmission, your Submission Breakdown on the Overview moves it from Pending to Approved within seconds, without refreshing.",
  "",
  "VERA, YOUR PORTAL ASSISTANT",
  "• Common questions are now answered faster.",
  "• VERA is better protected: it will not follow attempts to change how it works, and it never shows passwords, keys or other confidential system information in its answers.",
  "",
  "If anything does not look right for your facility, please report it through Support so EMB Region III can check it against your records.",
].join("\n");

function buildAnnouncementPayload() {
  return {
    enabled: true,
    type: "info",
    priority: "normal",
    title: ANNOUNCEMENT_TITLE,
    summary: "Profile pictures, step-by-step transport entries, corrections that resubmit the original entry, accurate request statuses, and a live report.",
    message: ANNOUNCEMENT_MESSAGE,
    // 10 Nov 2026 00:00 to 24 Nov 2026 23:59, Philippine time (UTC+8).
    startAt: new Date("2026-11-09T16:00:00.000Z"),
    endAt: new Date("2026-11-24T15:59:59.000Z"),
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
    item.createdBy = "release 1.7.0 seed";
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
