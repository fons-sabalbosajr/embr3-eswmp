import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  PORTAL_UPDATE_TOUR_SEEN_PREFIX,
  PORTAL_TOUR_DISMISSED_PREFIX,
  PORTAL_FEATURE_TOUR_SEEN_PREFIX,
  PORTAL_FEATURE_TOUR_OPT_OUT_PREFIX,
} from "../constants";
import {
  PORTAL_FEATURE_TOUR_VERSION,
  PORTAL_FEATURE_TOUR_STEPS,
  PORTAL_FEATURE_TOUR_VERA_PROMPT,
} from "../portalFeatureTour";
import secureStorage from "../../../utils/secureStorage";
import api from "../../../api";
import { Space, Button } from "antd";

export default function usePortalTours({
  baselineActionRef, baselineGapsRef, baselinePanelRef, baselineSaved, baselineStatusRef,
  baselineUpdatePending, dataEntryTabsRef, haulerTableRef, portalSettings, portalUser,
  setActiveMenu, setActiveTab, setCollapsedBaselineCards, slfSelectorRef, truckTableRef,
  truckUploadRef,
}) {
  const [portalAnnouncement, setPortalAnnouncement] = useState(null);
  // Which announcement VERSION this user dismissed. Version-keyed rather than a
  // boolean so a newly published announcement still reaches them — muting the
  // banner forever would be worse than the reload-and-it's-back behaviour this
  // replaces, since it is how maintenance and rollout notices are delivered.
  const [announcementDismissedVersion, setAnnouncementDismissedVersion] = useState(null);
  // Temporarily overrides the dismissal while the tour is running: the tour's
  // first step points at the banner, so it has to be on screen to be pointed at.
  const [announcementRevealed, setAnnouncementRevealed] = useState(false);
  const [updateTourOpen, setUpdateTourOpen] = useState(false);
  const [updateTourCurrent, setUpdateTourCurrent] = useState(0);
  // "Don't show again" for the What's New tour. The SERVER copy is the source of
  // truth (see PATCH /portal-auth/ui-preferences) because logout wipes
  // localStorage; this holds the resolved answer for the session so neither the
  // tour nor the banner can act before the preferences have been read.
  const [tourDismissed, setTourDismissed] = useState(false);
  const [uiPrefsLoaded, setUiPrefsLoaded] = useState(false);
  const announcementBannerRef = useRef(null);
  // ── Feature tour (versioned, separate from the orientation tour above) ──
  // Records WHICH release the user has seen, so a portal user who dismissed the
  // orientation tour is still shown a workflow change. See portalFeatureTour.js.
  const [featureTourSeenVersion, setFeatureTourSeenVersion] = useState(null);
  // Permanent "Don't show this again" for the feature tour, independent of the
  // release marker above.
  const [featureTourOptOut, setFeatureTourOptOut] = useState(false);
  const [featureTourOpen, setFeatureTourOpen] = useState(false);
  const [featureTourCurrent, setFeatureTourCurrent] = useState(0);
  // Set the instant the orientation tour claims the screen, so the feature
  // tour's auto-open — a separate effect in the same commit — can see it.
  const updateTourClaimedRef = useRef(false);

  const portalAnnouncementVersion =
    portalAnnouncement?.updatedAt ||
    portalAnnouncement?._id ||
    portalAnnouncement?.portalAnnouncementTitle ||
    "";
  const portalUpdateTourSeenKey = portalAnnouncementVersion
    ? `${PORTAL_UPDATE_TOUR_SEEN_PREFIX}${portalAnnouncementVersion}`
    : "";
  const portalMaintenanceActive = !!portalSettings?.portalMaintenanceMode;
  const portalMaintenanceMessage =
    portalSettings?.portalMaintenanceMessage ||
    portalSettings?.portalMaintenanceReason ||
    "The portal is currently under maintenance. Please try again later.";
  const isPortalUpdateAnnouncement = /\b(update|updates|what'?s new|guided tour|tour)\b/i.test(
    `${portalAnnouncement?.portalAnnouncementTitle || ""}\n${portalAnnouncement?.portalAnnouncementMessage || ""}`,
  );
  const hasMultipleAssignedSlf =
    Array.isArray(portalUser?.assignedSlfName) &&
    portalUser.assignedSlfName.length > 1;
  const tourDismissedKey = portalUser?.email
    ? `${PORTAL_TOUR_DISMISSED_PREFIX}${portalUser.email}`
    : null;
  const featureTourSeenKey = portalUser?.email
    ? `${PORTAL_FEATURE_TOUR_SEEN_PREFIX}${portalUser.email}`
    : null;
  const featureTourOptOutKey = portalUser?.email
    ? `${PORTAL_FEATURE_TOUR_OPT_OUT_PREFIX}${portalUser.email}`
    : null;
  // The tour is DUE when the user has not seen THIS release. A user who
  // dismissed the orientation tour, or a previous feature tour, is still shown
  // this one — which is the whole reason the marker is a version.
  // The tour is DUE when this release has not been seen AND the user has not
  // opted out for good. The two are separate answers: finishing or closing the
  // tour says "seen this one", and the next release is new information worth
  // offering once; the "Don't show this again" button says NEVER, and honouring
  // that only until the next version bump made the button's label untrue.
  const featureTourDue =
    !featureTourOptOut && featureTourSeenVersion !== PORTAL_FEATURE_TOUR_VERSION;

  // `manual: true` = the user asked for it from What's New, which always opens.
  // Only the AUTOMATIC opening honours the seen-marker.
  const openFeatureTour = useCallback(
    ({ manual = true } = {}) => {
      if (!manual && !featureTourDue) return;
      // The tour starts on Data Entry, on the tab its FIRST step lives on (steps
      // declare it in portalFeatureTour.js); later steps switch tabs as they go.
      // The tour's steps point into the Accredited Haulers card, so it is
      // unfolded first if the operator had folded it.
      setActiveMenu("data-entry");
      setActiveTab(PORTAL_FEATURE_TOUR_STEPS[0]?.tab || "baseline");
      // Not saved: the tour unfolds it for this run only, the operator's
      // remembered layout is kept.
      setCollapsedBaselineCards((prev) => prev.filter((k) => k !== "haulers"));
      setFeatureTourCurrent(0);
      // One frame for the panel to mount its content before antd measures the
      // first target.
      setTimeout(() => setFeatureTourOpen(true), 160);
    },
    [featureTourDue],
  );

  // ONE place that records "seen", used by every exit from the feature tour.
  // The local mirror is written first so the answer survives a failed request;
  // the server copy is what makes it survive logout.
  const markFeatureTourSeen = useCallback(() => {
    setFeatureTourOpen(false);
    setFeatureTourSeenVersion(PORTAL_FEATURE_TOUR_VERSION);
    try {
      if (featureTourSeenKey) secureStorage.set(featureTourSeenKey, PORTAL_FEATURE_TOUR_VERSION);
    } catch { /* storage blocked — the server copy still answers next login */ }
    api
      .patch("/portal-auth/ui-preferences", {
        featureTourVersionSeen: PORTAL_FEATURE_TOUR_VERSION,
      })
      .catch(() => {
        // Best-effort, exactly like the orientation tour: never interrupt the
        // user with an error for closing a tour.
      });
  }, [featureTourSeenKey]);

  // "Don't show this again" — the button, which means NEVER.
  //
  // Records the release as seen AND sets the permanent opt-out. Recording both
  // matters: the opt-out is what stops the next version reopening it, and the
  // version keeps the two answers consistent for anything that reads the marker.
  const optOutOfFeatureTour = useCallback(() => {
    setFeatureTourOpen(false);
    setFeatureTourOptOut(true);
    setFeatureTourSeenVersion(PORTAL_FEATURE_TOUR_VERSION);
    try {
      if (featureTourOptOutKey) secureStorage.set(featureTourOptOutKey, "1");
      if (featureTourSeenKey) secureStorage.set(featureTourSeenKey, PORTAL_FEATURE_TOUR_VERSION);
    } catch { /* storage blocked — the server copy still answers next login */ }
    api
      .patch("/portal-auth/ui-preferences", {
        featureTourOptOut: true,
        featureTourVersionSeen: PORTAL_FEATURE_TOUR_VERSION,
      })
      .catch(() => {
        // Best-effort, like every other tour write: never interrupt somebody for
        // closing a tour. The local mirror already holds it for this browser.
      });
  }, [featureTourOptOutKey, featureTourSeenKey]);

  // Hand the user to VERA with the question already asked, so "tell me more"
  // lands them in a conversation rather than an empty chat. Closing the tour
  // first also marks it seen — they got the walkthrough, just conversationally.
  const askVeraAboutFeature = useCallback(
    (question) => {
      markFeatureTourSeen();
      window.dispatchEvent(
        new CustomEvent("vera:open", {
          detail: { ask: question || PORTAL_FEATURE_TOUR_VERA_PROMPT },
        }),
      );
    },
    [markFeatureTourSeen],
  );

  // `manual: true` = the user clicked "What's New Tour" themselves, which always
  // opens it. Only the AUTOMATIC opening honours the preference — a dismissal
  // that also disabled the button left the user with no way back in.
  const openPortalUpdateTour = useCallback(
    ({ manual = true } = {}) => {
      if (!manual && (tourDismissed || (tourDismissedKey && secureStorage.get(tourDismissedKey) === "1"))) {
        return;
      }
      // Claimed SYNCHRONOUSLY, before any state update. The feature tour's
      // auto-open runs as a separate effect in the SAME commit, where
      // `updateTourOpen` is still the previous render's `false` — so a state
      // flag cannot stop the two from opening on top of each other. A ref is
      // visible immediately, which is what actually holds the second one back.
      updateTourClaimedRef.current = true;
      // Show the banner for the duration of the tour without discarding the
      // user's dismissal — the first step targets it.
      setAnnouncementRevealed(true);
      setActiveMenu("data-entry");
      setUpdateTourCurrent(0);
      setUpdateTourOpen(true);
    },
    [tourDismissed, tourDismissedKey],
  );

  // ONE place that records "never show this again", used by every exit from the
  // tour. The local mirror is written first so the answer survives even if the
  // request fails; the server copy is what makes it survive logout.
  const dismissTourPermanently = useCallback(() => {
    setUpdateTourOpen(false);
    setTourDismissed(true);
    // Hand the banner back to whatever the user's own dismissal says.
    setAnnouncementRevealed(false);
    try {
      if (tourDismissedKey) secureStorage.set(tourDismissedKey, "1");
      if (portalUpdateTourSeenKey) secureStorage.set(portalUpdateTourSeenKey, "1");
    } catch { /* storage blocked — the server copy still answers next login */ }
    api.patch("/portal-auth/ui-preferences", { tourDismissed: true }).catch(() => {
      // Best-effort: the local mirror already suppresses it in this browser, and
      // the next successful dismissal will persist it. Never interrupt the user
      // with an error for closing a tour.
    });
  }, [portalUpdateTourSeenKey, tourDismissedKey]);

  // Dismissing the announcement banner. Persisted against the CURRENT version, so
  // it stays gone across reloads and logins but a new announcement still appears.
  const dismissAnnouncement = useCallback(() => {
    if (!portalAnnouncementVersion) return;
    setAnnouncementDismissedVersion(portalAnnouncementVersion);
    setAnnouncementRevealed(false);
    api
      .patch("/portal-auth/ui-preferences", {
        announcementDismissedVersion: portalAnnouncementVersion,
      })
      .catch(() => {
        // Best-effort, exactly like the tour: it is hidden for this session
        // regardless, and a failed write only costs the banner reappearing later.
      });
  }, [portalAnnouncementVersion]);

  // The banner is hidden only when THIS announcement is the one that was
  // dismissed — and never while the tour is pointing at it.
  const announcementDismissed =
    !announcementRevealed &&
    !!portalAnnouncementVersion &&
    announcementDismissedVersion === portalAnnouncementVersion;

  // Resolve both dismissals once per signed-in user, server first. Until this
  // answers, `uiPrefsLoaded` holds back the tour's auto-open AND the banner, so a
  // slow response can never flash either at somebody who already dismissed them.
  useEffect(() => {
    if (!portalUser?.email) return undefined;
    let cancelled = false;
    // The local mirror answers instantly and covers the offline case; the server
    // is what makes the choice survive logout, which is the whole point.
    let mirrored = false;
    try { mirrored = tourDismissedKey && secureStorage.get(tourDismissedKey) === "1"; } catch { /* blocked */ }
    if (mirrored) setTourDismissed(true);
    try {
      const seen = featureTourSeenKey && secureStorage.get(featureTourSeenKey);
      if (seen) setFeatureTourSeenVersion(seen);
      // The opt-out mirror answers before the server does, so a user who said
      // "never" does not get one flash of the tour on a slow connection.
      if (featureTourOptOutKey && secureStorage.get(featureTourOptOutKey) === "1") {
        setFeatureTourOptOut(true);
      }
    } catch { /* blocked */ }

    api
      .get("/portal-auth/ui-preferences")
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.tourDismissed) {
          setTourDismissed(true);
          // Re-seat the mirror: a logout wiped it, and this is the read that
          // repairs it for the rest of the session.
          try { if (tourDismissedKey) secureStorage.set(tourDismissedKey, "1"); } catch { /* blocked */ }
        }
        if (data?.announcementDismissedVersion) {
          setAnnouncementDismissedVersion(data.announcementDismissedVersion);
        }
        if (data?.featureTourVersionSeen) {
          setFeatureTourSeenVersion(data.featureTourVersionSeen);
          try {
            if (featureTourSeenKey) secureStorage.set(featureTourSeenKey, data.featureTourVersionSeen);
          } catch { /* blocked */ }
        }
        if (data?.featureTourOptOut) {
          setFeatureTourOptOut(true);
          // Re-seat the mirror the same way the orientation tour's does: a logout
          // wipes it, and this read is what repairs it for the session.
          try {
            if (featureTourOptOutKey) secureStorage.set(featureTourOptOutKey, "1");
          } catch { /* blocked */ }
        }
      })
      .catch(() => { /* keep whatever the mirror said */ })
      .finally(() => { if (!cancelled) setUiPrefsLoaded(true); });

    return () => { cancelled = true; };
  }, [portalUser?.email, tourDismissedKey, featureTourSeenKey, featureTourOptOutKey]);

  // Feature-tour steps: copy comes from portalFeatureTour.js (VERA reads the
  // same list), targets are resolved here because the refs are local. A step
  // whose target is not mounted falls back to the haulers panel rather than
  // anchoring to nothing — antd renders a targetless step centred, which reads
  // as a broken tour.
  const featureTourSteps = useMemo(() => {
    // Each step names the TAB its target lives on as well as the ref. The Data
    // Entry tabs render their children lazily, so a step pointing into a tab that
    // is not open would anchor to nothing and antd would centre it — which reads
    // as a broken tour. The order below crosses tabs exactly once.
    // A step points at a ref on Data Entry, at the facility card's Save as Draft
    // / Review & Submit actions, or — for a change on another screen — at that
    // screen's sidebar menu item (step.menu). Anything not mounted (a collapsed
    // sidebar, a phone layout) falls back to the Data Entry form rather than
    // anchoring to nothing.
    const refTargets = {
      "transport-steps": truckTableRef,
      completeness: baselineGapsRef,
      "special-zones": haulerTableRef,
      "system-generated": truckUploadRef,
      mismatch: truckUploadRef,
      "preview-grid": truckUploadRef,
      "cell-placement": truckTableRef,
    };
    const resolveTarget = (step) => {
      if (step.menu) {
        return document.querySelector(`.ant-menu-item[data-menu-id$="-${step.menu}"]`);
      }
      if (step.key === "correction-draft") {
        return document.querySelector(".slf-facility-card .ant-card-extra");
      }
      return refTargets[step.key]?.current || null;
    };
    return PORTAL_FEATURE_TOUR_STEPS.map((step) => ({
      key: step.key,
      title: step.title,
      description: (
        <div>
          <div style={{ marginBottom: 8 }}>{step.description}</div>
          <Space size={8} wrap>
            <Button
              size="small"
              type="link"
              style={{ padding: 0, height: "auto" }}
              onClick={() => askVeraAboutFeature(step.ask)}
            >
              Ask VERA about this →
            </Button>
            {/* Offered on EVERY step, not only the last. Closing the tour is not
                the same as never wanting to see it — this is the action that says
                so.
                It calls optOutOfFeatureTour, NOT markFeatureTourSeen: the latter
                records only the current release, so the tour came back at the
                next version bump for someone who had explicitly asked it not to.
                What's New still reopens it on demand. */}
            <Button
              size="small"
              type="link"
              style={{ padding: 0, height: "auto", color: "#8c8c8c" }}
              onClick={optOutOfFeatureTour}
            >
              Don&apos;t show this again
            </Button>
          </Space>
        </div>
      ),
      tab: step.menu ? undefined : step.tab || "baseline",
      target: () =>
        resolveTarget(step) || truckTableRef.current || dataEntryTabsRef.current || haulerTableRef.current,
      placement: step.menu ? "right" : "top",
    }));
  }, [askVeraAboutFeature, optOutOfFeatureTour]);

  const updateTourSteps = useMemo(() => {
    const steps = [
      {
        key: "announcement",
        title: "Today's portal updates",
        description:
          "This banner is where the latest SLF portal changes are announced. Use it to review rollout notes and update guidance.",
        target: () => announcementBannerRef.current,
        placement: "bottom",
      },
    ];

    if (hasMultipleAssignedSlf) {
      steps.push({
        key: "slf-selector",
        title: "Switch your assigned SLF",
        description:
          "If your account handles more than one facility, switch here before reviewing baseline or disposal records.",
        target: () => slfSelectorRef.current,
        placement: "bottom",
      });
    }

    steps.push(
      {
        key: "baseline-tab",
        title: "Baseline tab",
        description:
          "Baseline records now stay tied to the assigned SLF more reliably, including after facility rename updates.",
        target: () => dataEntryTabsRef.current,
        placement: "top",
      },
      {
        key: "baseline-actions",
        title: baselineSaved ? "Baseline change workflow" : "Save your baseline",
        description: baselineSaved
          ? baselineUpdatePending
            ? "Your request is pending admin review. Use Refresh here to check when editing becomes available again."
            : "After the first save locks the baseline, use Request Update here whenever admin approval is needed."
          : "When editing is available, save the updated baseline here so it remains linked to the correct assigned facility.",
        target: () =>
          baselineActionRef.current ||
          baselineStatusRef.current ||
          baselinePanelRef.current ||
          dataEntryTabsRef.current,
        placement: "top",
        // Say plainly what finishing does. The tour has always stopped appearing
        // once closed or completed — the label makes that a promise the user can
        // see, rather than something they have to test by logging out.
        nextButtonProps: { children: "Got it — don't show again" },
      },
    );

    return steps;
  }, [baselineSaved, baselineUpdatePending, hasMultipleAssignedSlf]);
  // Facility management modals (Leachate, Gas Management, Trash Slide, Fire Prevention)

  return {
    announcementBannerRef, announcementDismissed, dismissAnnouncement, dismissTourPermanently,
    featureTourCurrent, featureTourDue, featureTourOpen, featureTourSteps,
    isPortalUpdateAnnouncement, markFeatureTourSeen, openFeatureTour, openPortalUpdateTour,
    portalAnnouncement, portalMaintenanceActive, portalMaintenanceMessage, portalUpdateTourSeenKey,
    setFeatureTourCurrent, setFeatureTourOpen, setPortalAnnouncement, setUpdateTourCurrent,
    tourDismissed, uiPrefsLoaded, updateTourClaimedRef, updateTourCurrent, updateTourOpen,
    updateTourSteps,
  };
}
