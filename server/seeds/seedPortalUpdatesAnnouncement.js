const mongoose = require("mongoose");
require("dotenv").config();

const AppSettings = require("../models/AppSettings");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";

const ANNOUNCEMENT_TITLE = "SLF Portal Updates - June 25, 2026";
const ANNOUNCEMENT_MESSAGE = [
  "Today's SLF portal updates are now live:",
  "",
  "• Baseline records now stay linked to the assigned SLF even after facility renames or display-name updates.",
  "• The renamed Bataan Engineered Sanitary Facility (BSELF) baseline flow has been corrected so portal baseline data remains available.",
  "• A new guided What's New tour is now available inside the SLF Portal for the announcement area, SLF selector, and baseline update workflow.",
  "• Admin portal user display was tightened for assigned SLF names.",
].join("\n");

function buildAnnouncementPayload() {
  return {
    enabled: true,
    type: "info",
    title: ANNOUNCEMENT_TITLE,
    message: ANNOUNCEMENT_MESSAGE,
    startAt: new Date("2026-06-25T00:00:00.000Z"),
    endAt: null,
    showOnLogin: true,
    showInPortal: true,
    dismissible: true,
    emailSubject: ANNOUNCEMENT_TITLE,
    emailMessage: ANNOUNCEMENT_MESSAGE,
  };
}

async function run() {
  await mongoose.connect(MONGODB_URI);

  let settings = await AppSettings.findOne();
  if (!settings) settings = new AppSettings();

  const payload = buildAnnouncementPayload();
  let created = false;
  let item = (settings.portalAnnouncements || []).find(
    (announcement) => announcement.title === ANNOUNCEMENT_TITLE,
  );

  settings.portalAnnouncements.forEach((announcement) => {
    announcement.enabled = false;
  });

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
  settings.portalAnnouncementEmailSubject = payload.emailSubject;
  settings.portalAnnouncementEmailMessage = payload.emailMessage;

  await settings.save();

  console.log(
    `${created ? "Created" : "Updated"} portal announcement: ${ANNOUNCEMENT_TITLE}`,
  );
}

run()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (error) => {
    console.error("Failed to seed portal announcement:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });