import { useRef, useEffect } from "react";
import { fetchWithCache } from "../../../utils/pageCache";
import { PORTAL_SETTINGS_CACHE_KEY, PORTAL_CACHE_TTL } from "../constants";
import api from "../../../api";
import secureStorage from "../../../utils/secureStorage";
import { Modal } from "antd";

export default function usePortalAnnouncements({
  featureTourDue, isPortalUpdateAnnouncement, openFeatureTour, openPortalUpdateTour,
  portalAnnouncement, portalUpdateTourSeenKey, portalUser, setActiveMenu, setActiveTab,
  setPortalAnnouncement, setPortalSettings, tourDismissed, uiPrefsLoaded, updateTourClaimedRef,
  updateTourCurrent, updateTourOpen, updateTourSteps,
}) {
  const featureTourAutoOpenedRef = useRef(false);

  const isAnnouncementActive = (settings) => {
    const now = Date.now();
    const startsAt = settings?.portalAnnouncementStartAt
      ? new Date(settings.portalAnnouncementStartAt).getTime()
      : null;
    const endsAt = settings?.portalAnnouncementEndAt
      ? new Date(settings.portalAnnouncementEndAt).getTime()
      : null;
    return (
      settings?.portalAnnouncementLive !== false &&
      settings?.portalAnnouncementEnabled &&
      settings?.portalAnnouncementShowInPortal !== false &&
      (!startsAt || startsAt <= now) &&
      (!endsAt || endsAt >= now)
    );
  };

  useEffect(() => {
    fetchWithCache(
      PORTAL_SETTINGS_CACHE_KEY,
      () => api.get("/settings/app").then(({ data }) => data),
      {
        ttl: PORTAL_CACHE_TTL,
        onData: (data) => {
        setPortalSettings(data);
        setPortalAnnouncement(isAnnouncementActive(data) ? data : null);
        },
      },
    ).catch(() => {});
  }, []);

  useEffect(() => {
    if (!portalAnnouncement || !portalUser) return;
    // Wait for the tour preference before deciding anything. This check has to
    // come BEFORE the seen-marker below: marking the announcement seen and then
    // bailing out would consume the session's one chance to show it, so a slow
    // preference read would silently swallow the announcement entirely.
    if (!uiPrefsLoaded) return;
    const key = `portal-announcement-seen-${portalAnnouncement.updatedAt || portalAnnouncement._id || portalAnnouncement.portalAnnouncementTitle}`;
    if (secureStorage.sessionGet(key) === "1") return;
    secureStorage.sessionSet(key, "1");
    if (isPortalUpdateAnnouncement) {
      if (
        !tourDismissed &&
        portalUpdateTourSeenKey &&
        secureStorage.get(portalUpdateTourSeenKey) !== "1"
      ) {
        openPortalUpdateTour({ manual: false });
      }
      return;
    }
    Modal.info({
      title:
        portalAnnouncement.portalAnnouncementTitle || "SLF Portal Announcement",
      content: (
        <div style={{ whiteSpace: "pre-wrap" }}>
          {portalAnnouncement.portalAnnouncementMessage}
        </div>
      ),
      okText: "Got it",
      width: 560,
    });
  }, [
    isPortalUpdateAnnouncement,
    openPortalUpdateTour,
    portalAnnouncement,
    portalUpdateTourSeenKey,
    portalUser,
    tourDismissed,
    uiPrefsLoaded,
  ]);

  // Auto-open the FEATURE tour once, for a user who has not seen this release.
  //
  // Gated on `uiPrefsLoaded` so a slow preference read can never flash the tour
  // at somebody who already dismissed it, and held behind the orientation tour
  // so the two can never fight over the screen. The ref makes it at most once
  // per mount regardless of how often this re-runs.
  useEffect(() => {
    if (!uiPrefsLoaded || featureTourAutoOpenedRef.current) return;
    if (!portalUser?.email || !featureTourDue) return;
    // Both the state AND the ref: the state covers a later render, the ref
    // covers the orientation tour claiming the screen earlier in THIS commit
    // (which an announcement mentioning "update" or "what's new" triggers).
    // The feature tour stays due, so it opens on the next visit instead.
    if (updateTourOpen || updateTourClaimedRef.current) return;
    featureTourAutoOpenedRef.current = true;
    openFeatureTour({ manual: false });
  }, [uiPrefsLoaded, portalUser?.email, featureTourDue, updateTourOpen, openFeatureTour]);

  useEffect(() => {
    if (!updateTourOpen) return;
    const stepKey = updateTourSteps[updateTourCurrent]?.key;
    if (!stepKey) return;
    if (stepKey !== "announcement") {
      setActiveMenu("data-entry");
    }
    if (stepKey === "baseline-tab" || stepKey === "baseline-actions") {
      setActiveTab("baseline");
    }
  }, [updateTourCurrent, updateTourOpen, updateTourSteps]);


  return {

  };
}
