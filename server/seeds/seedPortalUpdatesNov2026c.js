/**
 * Portal announcement — SLF Portal updates, 25 November 2026 (release 1.10.0).
 *
 * Written for PORTAL USERS (SLF operators, MENRO/CENRO officers, PCOs). Only
 * what changes for them in the portal — the six improvements proposed in
 * docs/files/Proposed_SLF_Portal_Improvements.pptx plus the screen-fit fixes.
 * Admin-side work in the same release (the Portal Submissions detail redesign,
 * the Disposal Calendar layout, the index.jsx split) is left out: portal users
 * cannot see it.
 *
 * Previews by default; publishes only with --apply (outward-facing — same
 * convention as seedPortalUpdatesNov2026b.js). It does NOT send the email; that
 * stays a separate, deliberate action in Developer Settings.
 *
 * The announcement has an end date, so it leaves the login page by itself.
 * Publishing it makes it the ONE active announcement (it replaces the 1.9 one,
 * which would have ended on 8 Dec 2026).
 *
 * Usage
 * -----
 *   node seeds/seedPortalUpdatesNov2026c.js            # preview, writes nothing
 *   node seeds/seedPortalUpdatesNov2026c.js --apply    # publish (AFTER deploying)
 */
const mongoose = require("mongoose");
require("dotenv").config();

const AppSettings = require("../models/AppSettings");
const { connectMongo } = require("../config/mongo");

const APPLY = process.argv.includes("--apply");
const MONGODB_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",").map((v) => v.trim()).filter(Boolean);

const ANNOUNCEMENT_TITLE = "SLF Portal Updates - November 25, 2026";

const ANNOUNCEMENT_MESSAGE = [
  "The following SLF Portal improvements, requested by portal users, are now live:",
  "",
  "AUTOSAVE TO DRAFTS",
  "• Your Data Entry now saves itself to Drafts & Scheduled a few seconds after you stop typing — no need to click Save. If the browser closes or the internet drops, your work is waiting in Drafts & Scheduled.",
  "• The Drafts & Scheduled list shows when each draft was last saved. Open a draft any time to finish and submit it.",
  "• Baseline changes are not autosaved; if you leave with unsaved baseline changes, the portal asks first.",
  "",
  "MY DOCUMENTS (NEW MENU)",
  "• A new My Documents menu lists every file your facility has submitted — MOVs, letters and attachments — by date and type.",
  "• Filter by type, cell or Submission ID, tick the files you need, and download them together as one .zip file.",
  "",
  "BACKLOG UPLOAD",
  "• You can upload up to one month of missed days in a single file. Each disposal date is still saved as its own submission with its own Submission ID.",
  "• Dates older than one month, or in the future, cannot be uploaded.",
  "",
  "TONS CONVERTED TO m³",
  "• If your trucks are weighed in tons but your facility reports in m³ (or the other way round), the portal converts the value for you before you submit, using 1 m³ = 0.5 tons. The weight you entered is kept with the record.",
  "",
  "CORRECTED DATA FROM EMB",
  "• When EMB Region III verifies or corrects a client, hauler or address, the corrected details now appear in your baseline, marked Verified by EMB, and you receive a notification.",
  "",
  "NAME MATCHING",
  "• Small differences in hauler names, client names and addresses — periods, commas, capital letters, extra spaces — no longer cause false flags.",
  "• A real difference, such as a different or missing word or letter, still asks you to confirm with a \"Did you mean …?\" suggestion.",
  "",
  "CELL CAPACITY",
  "• Cell capacities, Waste in Cell and remaining space now read exactly the same in the portal as in EMB Region III's records, and the capacity check uses those same figures.",
  "",
  "SCREENS",
  "• Windows (pop-ups) now always fit your screen — the title and buttons stay in view and only the content scrolls. Tables inside a window scroll in their own area.",
  "• On the Dashboard, the Permits & Clearances tiles now fill the whole card on any screen size.",
  "",
  "If anything does not look right for your facility, please report it through Support so EMB Region III can check it against your records.",
].join("\n");

function buildAnnouncementPayload() {
  return {
    enabled: true,
    type: "info",
    priority: "normal",
    title: ANNOUNCEMENT_TITLE,
    summary: "Autosave to Drafts, a new My Documents menu with .zip download, one-month backlog upload, tons-to-m³ conversion, EMB-verified data, smarter name matching, and windows that fit your screen.",
    message: ANNOUNCEMENT_MESSAGE,
    // 25 Nov 2026 00:00 to 9 Dec 2026 23:59, Philippine time (UTC+8).
    startAt: new Date("2026-11-24T16:00:00.000Z"),
    endAt: new Date("2026-12-09T15:59:59.000Z"),
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
    item.createdBy = "release 1.10 seed";
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
