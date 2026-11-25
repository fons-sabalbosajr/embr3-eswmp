import { useState, useRef, useCallback, useEffect } from "react";
import { fetchWithCache, invalidateCache } from "../../../utils/pageCache";
import {
  PORTAL_SUBMISSIONS_CACHE_KEY,
  PORTAL_CACHE_TTL,
  PORTAL_WASTE_RECEIVED_CACHE_KEY,
  PORTAL_SETTINGS_CACHE_KEY,
} from "../constants";
import api from "../../../api";
import secureStorage from "../../../utils/secureStorage";
import { connectSocket } from "../../../utils/socket";
import dayjs from "dayjs";
import Swal from "sweetalert2";

export default function useSubmissionHistory({
  activeMenu, activeSlfId, activeSlfName, baselineDirtyRef, confirmDiscardBaseline,
  invalidateMenuCache, isDeveloperContext, isMenuDataFresh, isOnline, markMenuFetched, navigate,
  portalUser, setBaselineRefresh, setBaselineRemoteChanged, setPortalSettings, setSlfInfoRefresh,
  setSubmissions, showError, submissions,
}) {
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  // Bumped by the socket handler when something an admin changed affects the
  // client roster. Sits beside the two counters above for the same reason: the
  // fetch it drives lives far below the handler that needs to trigger it.
  const [wasteReceivedRefresh, setWasteReceivedRefresh] = useState(0);
  const [portalMessages, setPortalMessages] = useState([]);
  // My Requests / Activity Log states
  const [myRequests, setMyRequests] = useState([]);
  const [myRequestsLoading, setMyRequestsLoading] = useState(false);

  // Fetch submission history
  const pollingRef = useRef(null);
  const fetchingRef = useRef(false);
  // A refresh asked for while a fetch is already in flight. That fetch may have
  // left BEFORE the change it would miss (an admin approving a resubmission),
  // and dropping the second call cached its stale answer as fresh for the whole
  // TTL — the Submission Breakdown kept the entry under Pending/Reverted after it
  // was approved. Instead, one forced re-read runs as soon as the first returns.
  const refetchQueuedRef = useRef(false);

  const fetchSubmissions = useCallback(async (silent = false, force = false) => {
    if (fetchingRef.current) {
      refetchQueuedRef.current = true;
      return;
    }
    fetchingRef.current = true;
    if (!silent) setLoadingSubmissions(true);
    try {
      await fetchWithCache(
        `${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`,
        () => api.get("/portal-auth/my-submissions", {
          headers: {
            Authorization: `Bearer ${secureStorage.get("portal_token")}`,
          },
        }).then(({ data }) => data),
        {
          ttl: PORTAL_CACHE_TTL,
          force,
          onData: (data) => setSubmissions(Array.isArray(data) ? data : []),
        },
      );
    } catch {
      // Surface load failures so the table doesn't stay stuck silently
      if (!silent) {
        showError({
          type: "error",
          title: "Could Not Load Records",
          message:
            "We couldn't load your submission records. Please check your connection and tap Refresh to try again.",
        });
      }
    } finally {
      fetchingRef.current = false;
      if (!silent) setLoadingSubmissions(false);
      if (refetchQueuedRef.current) {
        refetchQueuedRef.current = false;
        invalidateCache(`${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`);
        // Deferred so the recursion never runs inside this call's own finally.
        setTimeout(() => fetchSubmissionsRef.current?.(true, true), 0);
      }
    }
  }, [portalUser?.email]);
  const fetchSubmissionsRef = useRef(null);
  fetchSubmissionsRef.current = fetchSubmissions;

  // The other half of the History badge is `revertedCount`, derived from
  // `submissions` — and that list was only refreshed while the History or
  // Overview menu was open (see the effect below). So an admin reverting a
  // submission while the operator was on Data Entry moved the badge not at all
  // until they happened to navigate to the very screen the badge exists to send
  // them to. This subscribes wherever they are; the initial load and the 60s
  // fallback poll stay with the menus that actually render the list, so nothing
  // starts polling in the background.
  useEffect(() => {
    if (!portalUser?.email) return undefined;
    if (activeMenu === "history" || activeMenu === "overview") return undefined; // owned below
    const sock = connectSocket("portal", portalUser.email);
    let timer = null;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        invalidateCache(`${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`);
        fetchSubmissions(true);
      }, 400);
    };
    sock.on("notification", handler);
    sock.on("data-refresh", handler);
    return () => {
      clearTimeout(timer);
      sock.off("notification", handler);
      sock.off("data-refresh", handler);
    };
  }, [activeMenu, portalUser?.email, fetchSubmissions]);

  useEffect(() => {
    if ((activeMenu === "history" || activeMenu === "overview") && portalUser) {
      // Entering history/overview used to blow the cache away and force a full
      // refetch EVERY time, which is why each menu switch showed a loading state
      // for data the portal already had. The force-refresh existed so admin
      // status changes appeared immediately — but the socket handler below
      // already delivers those the moment they happen, and the 60s poll backs it
      // up. So force only when the data is actually cold.
      const subsKey = `subs:${portalUser?.email || ""}`;
      if (!isMenuDataFresh(subsKey)) {
        markMenuFetched(subsKey);
        invalidateCache(`${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`);
        fetchSubmissions(false, true);
      }
      // Real-time refresh via socket + fallback 60s polling
      const sock = connectSocket("portal", portalUser.email);
      const handler = () => {
        // Something actually changed — drop the menu-entry cache so the next
        // switch re-reads rather than trusting a now-stale timestamp.
        invalidateMenuCache();
        invalidateCache(`${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`);
        invalidateCache(`${PORTAL_WASTE_RECEIVED_CACHE_KEY}:${activeSlfId || activeSlfName}`);
        fetchSubmissions(true);
      };
      sock.on("notification", handler);
      sock.on("data-refresh", handler);
      pollingRef.current = setInterval(() => {
        if (navigator.onLine) fetchSubmissions(true);
      }, 60000);
      return () => {
        sock.off("notification", handler);
        sock.off("data-refresh", handler);
        if (pollingRef.current) clearInterval(pollingRef.current);
      };
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
    // Depend on portalUser.email (a stable primitive), NOT the whole portalUser
    // object. portalUser changes reference several times on mount (localStorage
    // load → /me refresh, doubled by StrictMode); depending on the object made
    // this effect tear down and re-run each time, firing redundant force-refresh
    // my-submissions fetches and reconnecting the socket + resetting the poll —
    // which flickered and reloaded the overview KPIs/charts on every mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMenu, activeSlfId, activeSlfName, portalUser?.email, fetchSubmissions]);

  // When coming back online while on history tab, refresh immediately
  useEffect(() => {
    if (isOnline && (activeMenu === "history" || activeMenu === "overview") && portalUser) {
      fetchSubmissions(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, activeMenu, portalUser?.email, fetchSubmissions]);

  // VERA contextual runtime nudge: gently remind the user when submissions were
  // reverted for correction. Dispatched to the mounted VeraChat, which throttles
  // it to once per browser session and keeps it non-intrusive.
  useEffect(() => {
    if (!Array.isArray(submissions) || submissions.length === 0) return;
    const reverted = submissions.filter((s) => String(s?.status || "").toLowerCase().includes("revert")).length;
    if (reverted > 0) {
      window.dispatchEvent(new CustomEvent("vera:nudge", {
        detail: {
          id: "portal_reverted",
          text: `You have ${reverted} submission${reverted === 1 ? "" : "s"} reverted for correction. Would you like me to guide you through resubmitting?`,
          cta: true,
        },
      }));
    }
  }, [submissions]);

  // Item #4: admin → portal-user messages. Fetch the user's active (undismissed)
  // messages once after login, then receive new ones in real time over the portal
  // socket room (no polling). Only ever the intended user's own messages.
  useEffect(() => {
    if (!portalUser?.email || isDeveloperContext) return undefined;
    let cancelled = false;
    api
      .get("/portal-messages/mine")
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setPortalMessages(list);
      })
      .catch(() => {});
    const sock = connectSocket("portal", portalUser.email);
    const onMessage = (payload) => {
      if (!payload || !payload._id) return;
      // De-dupe by id so a refresh + real-time echo of the same message never
      // queues twice.
      setPortalMessages((prev) => (prev.some((m) => m._id === payload._id) ? prev : [...prev, payload]));
    };
    sock.on("portal-message", onMessage);
    return () => {
      cancelled = true;
      sock.off("portal-message", onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalUser?.email, isDeveloperContext]);

  // Dismiss (mark read for the session) or "Do Not Show Again" (permanent) — both
  // owner-guarded server-side. Removes it from the visible list either way.
  const dismissPortalMessage = async (id, permanent) => {
    try {
      await api.patch(`/portal-messages/${id}/${permanent ? "dismiss" : "read"}`);
    } catch {
      /* best-effort — still hide locally so the user isn't stuck */
    }
    setPortalMessages((prev) => prev.filter((m) => m._id !== id));
  };

  const msgShowingRef = useRef(false);
  useEffect(() => {
    if (isDeveloperContext || msgShowingRef.current) return;
    const msg = portalMessages[0];
    if (!msg) return;
    msgShowingRef.current = true;
    const esc = (s) =>
      String(s ?? "").replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
      ));
    const when = msg.createdAt ? dayjs(msg.createdAt).format("MMM D, YYYY h:mm A") : "";
    Swal.fire({
      icon: "info",
      title: esc(msg.title || "Message from EMB Region III"),
      html:
        `<div style="text-align:left">` +
        `<div style="white-space:pre-wrap;word-break:break-word">${esc(msg.message)}</div>` +
        `<div style="margin-top:12px;font-size:12px;color:#888">` +
        `${esc(msg.senderName || "EMB Region III")}${when ? ` &middot; ${esc(when)}` : ""}</div>` +
        `</div>`,
      showDenyButton: true,
      confirmButtonText: "Dismiss",
      denyButtonText: "Do Not Show Again",
      confirmButtonColor: "#1a3353",
      denyButtonColor: "#8c8c8c",
      allowOutsideClick: false,
      focusConfirm: true,
    }).then(async (result) => {
      // Deny = permanent ("Do Not Show Again"); Confirm/Dismiss = read for now.
      await dismissPortalMessage(msg._id, result.isDenied === true);
      msgShowingRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalMessages, isDeveloperContext]);

  useEffect(() => {
    if (!portalUser?.email) return undefined;
    const sock = connectSocket("portal", portalUser.email);
    const onFacilityRefresh = (payload) => {
      const target = payload?.target;
      if (target === "app-settings") {
        invalidateCache(PORTAL_SETTINGS_CACHE_KEY);
        api
          .get("/settings/app")
          .then(({ data }) => setPortalSettings(data))
          .catch(() => {});
        return;
      }
      // `hauler-clients` is what the admin's Hauler Clients editor emits (see
      // notifyHaulerClientChange). It was not listed here, so an admin adding,
      // renaming or deleting a client reached the portal and was dropped on the
      // floor — the Overview's Clients Served and Accredited Haulers cards kept
      // showing the pre-edit roster until the page was reloaded by hand.
      const ROSTER_TARGETS = ["facility", "submissions", "baselines", "hauler-clients"];
      if (!target || ROSTER_TARGETS.includes(target)) {
        setSlfInfoRefresh((n) => n + 1);
        invalidateCache(`${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`);
        fetchSubmissions(true);
        // The client roster comes from the waste-received summary, which nothing
        // here refetched. Bumping the counter is all this handler does — the
        // effect that owns that fetch knows the active SLF (and therefore its
        // cache key), which this closure does not.
        setWasteReceivedRefresh((n) => n + 1);
      }
      // The baseline record itself (and with it the approval / lock state the Data
      // Entry form gates on) was NOT reloaded here — only slfInfo and the submission
      // list were. So an admin approving a baseline update left the portal showing
      // "Pending" until the page was reloaded by hand. Re-run the baseline fetch on
      // any baseline-affecting refresh.
      if (!target || ["baselines", "facility"].includes(target)) {
        // Reloading would REPLACE the operator's unsaved baseline edits with the
        // stored copy. While there are any, the reload waits for them: the
        // Baseline tab says EMB changed it and offers Reload / Keep editing.
        if (baselineDirtyRef.current()) setBaselineRemoteChanged(true);
        else setBaselineRefresh((n) => n + 1);
      }
    };
    sock.on("data-refresh", onFacilityRefresh);
    // Pushes sent while the socket was down (laptop asleep, mobile network
    // switch) are lost, which left permits/cells showing whatever was read
    // before. Re-read facility details whenever the connection comes back.
    const onReconnect = () => setSlfInfoRefresh((n) => n + 1);
    sock.io?.on?.("reconnect", onReconnect);
    return () => {
      sock.off("data-refresh", onFacilityRefresh);
      sock.io?.off?.("reconnect", onReconnect);
    };
  }, [portalUser?.email, fetchSubmissions]);

  // While the Dashboard is open, keep EMB-maintained facility details (permits,
  // cell configuration) current even if a socket push never arrives: re-read when
  // the tab regains focus and once a minute while it is visible. Re-reads are
  // silent (see the slfInfo effect), so nothing flickers.
  useEffect(() => {
    if (activeMenu !== "overview" || !activeSlfId) return undefined;
    const SYNC_MS = 60 * 1000;
    const bump = () => {
      if (document.visibilityState === "visible") setSlfInfoRefresh((n) => n + 1);
    };
    const timer = setInterval(bump, SYNC_MS);
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", bump);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", bump);
    };
  }, [activeMenu, activeSlfId]);

  // ── My Requests fetch ──
  // Requests panel data.
  //
  // Reads a PURPOSE-BUILT, index-backed endpoint (GET /transactions/my-requests)
  // instead of the generic admin search. The old call
  // (`/transactions?search=<email>&limit=100`) ran a case-insensitive regex over
  // four unindexed fields — a scan of the whole audit log, executed twice — and
  // then discarded almost every row client-side, which is why opening Requests
  // and pressing Refresh were both slow.
  //
  // The dependency is the EMAIL, not the portalUser object: depending on the
  // object made this callback (and therefore the socket effect below) re-create
  // on every unrelated portalUser re-render, re-subscribing and re-fetching.
  const portalEmail = portalUser?.email || "";
  const fetchMyRequests = useCallback(async () => {
    if (!portalEmail) return;
    setMyRequestsLoading(true);
    try {
      const { data } = await api.get("/transactions/my-requests", {
        params: { email: portalEmail },
      });
      setMyRequests(Array.isArray(data?.transactions) ? data.transactions : []);
    } catch {
      /* silent */
    } finally {
      setMyRequestsLoading(false);
    }
  }, [portalEmail]);

  useEffect(() => {
    if (activeMenu !== "requests" || !portalEmail) return undefined;
    fetchMyRequests();

    const sock = connectSocket("portal", portalEmail);
    // A single admin action can emit several events in quick succession; without
    // coalescing, each one fired its own request. One refresh per burst instead.
    let timer = null;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(fetchMyRequests, 400);
    };
    sock.on("notification", handler);
    sock.on("data-refresh", handler);
    return () => {
      clearTimeout(timer);
      sock.off("notification", handler);
      sock.off("data-refresh", handler);
    };
  }, [activeMenu, portalEmail, fetchMyRequests]);

  const handleLogout = async () => {
    if (!(await confirmDiscardBaseline("Logging out"))) return;
    secureStorage.clearAll();
    navigate("/slfportal/login");
  };

  return {
    fetchMyRequests, fetchSubmissions, handleLogout, loadingSubmissions, myRequests,
    myRequestsLoading, portalEmail, setMyRequests, wasteReceivedRefresh,
  };
}
