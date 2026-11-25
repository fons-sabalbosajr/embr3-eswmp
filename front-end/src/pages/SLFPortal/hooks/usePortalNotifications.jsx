import { useState, useCallback, useEffect } from "react";
import api from "../../../api";
import { isTestAdminNotice } from "../helpers";
import {
  MessageOutlined,
  CustomerServiceOutlined,
  CloseCircleOutlined,
  HistoryOutlined,
  AuditOutlined,
  CheckCircleOutlined,
  BellOutlined,
} from "@ant-design/icons";
import { connectSocket } from "../../../utils/socket";
import Swal from "sweetalert2";

export default function usePortalNotifications({
  activeMenu, activeSlfName, companyForm, portalEmail, portalUser, showError, supportForm,
  supportTicketsLoadAttemptedRef,
}) {
  // Support ticket states
  const [supportDrawerOpen, setSupportDrawerOpen] = useState(false);
  const [messageDrawerOpen, setMessageDrawerOpen] = useState(false);
  const [supportTab, setSupportTab] = useState("new-ticket");
  const [supportTickets, setSupportTickets] = useState([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportDetailModal, setSupportDetailModal] = useState(null);
  const [supportReplyText, setSupportReplyText] = useState("");
  const [supportTicketPagination, setSupportTicketPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0,
  });
  const [supportTicketSearch, setSupportTicketSearch] = useState("");
  const [supportTicketSorter, setSupportTicketSorter] = useState({
    field: "createdAt",
    order: "descend",
  });
  const [portalNotifications, setPortalNotifications] = useState([]);
  const [portalUnreadCount, setPortalUnreadCount] = useState(0);
  // Queued drafts / scheduled runs that failed to submit — drives the sidebar
  // badge on Drafts & Scheduled.
  const [queueAttentionCount, setQueueAttentionCount] = useState(0);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  // Support ticket attachments (screenshots / proof)
  const [ticketAttachments, setTicketAttachments] = useState([]);

  // ── Support Ticket Functions ──
  const fetchSupportTickets = useCallback(async (options = {}) => {
    if (!portalUser?.email) return;
    const nextPage = options.page || supportTicketPagination.current;
    const nextPageSize = options.pageSize || supportTicketPagination.pageSize;
    const nextSearch = options.search ?? supportTicketSearch;
    const nextSorter = options.sorter || supportTicketSorter;
    setSupportLoading(true);
    try {
      const { data } = await api.get(
        `/support-tickets/my-tickets/${encodeURIComponent(portalUser.email)}`,
        {
          params: {
            page: nextPage,
            limit: nextPageSize,
            search: nextSearch || undefined,
            sortField: nextSorter.field || "createdAt",
            sortOrder: nextSorter.order || "descend",
          },
        },
      );
      const rows = Array.isArray(data) ? data : data.tickets || [];
      setSupportTickets(
        rows.filter((ticket) => !isTestAdminNotice(ticket)),
      );
      setSupportTicketPagination({
        current: Array.isArray(data) ? nextPage : data.page || nextPage,
        pageSize: Array.isArray(data) ? nextPageSize : data.limit || nextPageSize,
        total: Array.isArray(data) ? rows.length : data.total || rows.length,
      });
      setSupportTicketSearch(nextSearch);
      setSupportTicketSorter(nextSorter);
      supportTicketsLoadAttemptedRef.current = true;
    } catch (err) {
      supportTicketsLoadAttemptedRef.current = true;
      showError({
        type: "error",
        title: "Could Not Load Support Tickets",
        message:
          err.response?.data?.message ||
          "We couldn't load your support tickets. Please check your connection and try again.",
      });
    } finally {
      setSupportLoading(false);
    }
  }, [portalUser?.email, supportTicketPagination.current, supportTicketPagination.pageSize, supportTicketSearch, supportTicketSorter]);

  const fetchPortalNotifications = useCallback(async () => {
    if (!portalUser?.email) return;
    const recipients = [
      ...new Set([portalUser.email, portalUser._id].filter(Boolean)),
    ];
    try {
      const responses = await Promise.all(
        recipients.map((recipient) =>
          api.get(`/notifications/${encodeURIComponent(recipient)}`, {
            params: {
              limit: 100,
            },
          }),
        ),
      );
      const notificationMap = new Map();
      responses.forEach(({ data }) => {
        (data.notifications || []).forEach((notification) => {
          if (!isTestAdminNotice(notification)) {
            notificationMap.set(notification._id, notification);
          }
        });
      });
      const notifications = Array.from(notificationMap.values()).sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
      );
      setPortalNotifications(notifications);
      setPortalUnreadCount(
        notifications.filter((notification) => !notification.read).length,
      );
    } catch {
      /* silent */
    }
  }, [portalUser?.email, portalUser?._id]);

  const isMessageNotification = (notification = {}) =>
    ["admin_message", "message_from_admin"].includes(notification.type) ||
    (notification.type === "support_ticket_reply" &&
      /message from admin|admin sent you a message|admin replied/i.test(
        `${notification.title || ""} ${notification.message || ""}`,
      ));

  const isSupportNotification = (notification = {}) =>
    notification.type === "support_ticket_reply" &&
    !isMessageNotification(notification);

  const getPortalNotificationMeta = (notification = {}) => {
    if (isMessageNotification(notification)) {
      return {
        label: "Admin Message",
        color: "blue",
        icon: <MessageOutlined />,
        action: "messages",
      };
    }
    if (isSupportNotification(notification)) {
      return {
        label: "Support Ticket",
        color: "purple",
        icon: <CustomerServiceOutlined />,
        action: "support",
      };
    }
    if (
      [
        "reverted",
        "status_change",
        "submission_edit_approved",
        "submission_edit_rejected",
      ].includes(notification.type)
    ) {
      const rejected = /rejected|reverted/i.test(
        `${notification.type} ${notification.title || ""}`,
      );
      return {
        label: rejected ? "Submission Update" : "Submission Status",
        color: rejected ? "red" : "green",
        icon: rejected ? <CloseCircleOutlined /> : <HistoryOutlined />,
        action: "history",
      };
    }
    if (
      ["baseline_update_approved", "baseline_update_rejected"].includes(
        notification.type,
      )
    ) {
      return {
        label: "Request Update",
        color: "geekblue",
        icon: <AuditOutlined />,
        action: "requests",
      };
    }
    // EMB verified / corrected a client in the hauler roster — opens the
    // Baseline tab, where the client now shows "Verified by EMB".
    if (notification.type === "data_verified_by_emb") {
      return {
        label: "Verified by EMB",
        color: "green",
        icon: <CheckCircleOutlined />,
        action: "baseline",
      };
    }
    // A scheduled run that exhausted its retries. The record is still in the
    // queue and is retryable, so the notice takes the operator to it.
    if (notification.type === "scheduled_submission_failed") {
      return {
        label: "Scheduled Submission",
        color: "red",
        icon: <CloseCircleOutlined />,
        action: "drafts",
      };
    }
    return {
      label: "Admin Update",
      color: "default",
      icon: <BellOutlined />,
      action: "none",
    };
  };


  const markPortalNotificationsRead = useCallback(
    async (category) => {
      const unread = portalNotifications.filter((notification) => {
        if (notification.read) return false;
        if (category === "messages") return isMessageNotification(notification);
        if (category === "support") return isSupportNotification(notification);
        if (category === "history") {
          return [
            "reverted",
            "status_change",
            "submission_edit_approved",
            "submission_edit_rejected",
          ].includes(notification.type);
        }
        if (category === "requests") {
          return [
            "baseline_update_approved",
            "baseline_update_rejected",
          ].includes(notification.type);
        }
        if (category === "all") return true;
        return false;
      });
      if (unread.length === 0) return;
      try {
        await Promise.all(
          unread.map((notification) =>
            api.patch(`/notifications/${notification._id}/read`),
          ),
        );
        await fetchPortalNotifications();
      } catch {
        /* silent */
      }
    },
    [portalNotifications, fetchPortalNotifications],
  );

  const markPortalNotificationRead = useCallback(
    async (notification) => {
      if (!notification?._id || notification.read) return;
      try {
        await api.patch(`/notifications/${notification._id}/read`);
        await fetchPortalNotifications();
      } catch {
        /* silent */
      }
    },
    [fetchPortalNotifications],
  );

  const shouldLoadPortalActivityData =
    notificationPanelOpen ||
    supportDrawerOpen ||
    messageDrawerOpen ||
    activeMenu === "history" ||
    activeMenu === "requests";

  // ── The BADGE feed: always on, wherever the operator is ─────────────────────
  //
  // The unread counts used to be fetched and subscribed inside the effect below,
  // which is gated on `shouldLoadPortalActivityData` — the notification panel
  // being open, or the History / Requests menu being active. So on Data Entry,
  // Overview and Drafts (where an operator spends nearly all of their time) NO
  // socket listener was attached and no count was ever fetched: the bell badge
  // sat at whatever it had been, and a reverted submission or an admin message
  // arriving right then showed nothing at all.
  //
  // A badge whose only job is to tell you something arrived cannot be gated on
  // already looking at the thing it is pointing to. This effect owns the counts
  // and nothing else: it subscribes once per signed-in session and re-reads on
  // each event, coalesced so one admin action that emits several events costs one
  // request. The heavier panel payloads (support tickets) stay gated below.
  // How many queued drafts / scheduled runs FAILED to submit.
  //
  // Counted here, not in DraftsScheduledPanel, because that panel is unmounted on
  // every other menu — and this is precisely the number the operator needs while
  // they are somewhere else.
  //
  // `countOnly` makes the server answer with the NUMBER. This used to download
  // every failed record — each one carrying a whole submission payload — and
  // then call `.length` on the array, on every socket event that touched the
  // account. A badge is not worth a payload download, let alone a repeated one.
  const fetchQueueAttention = useCallback(async () => {
    if (!portalEmail) return;
    try {
      const { data } = await api.get("/portal-queue", {
        params: { email: portalEmail, status: "failed", countOnly: 1 },
      });
      setQueueAttentionCount(
        Array.isArray(data) ? data.length : Number(data?.count) || 0,
      );
    } catch {
      /* silent — a badge must never break the page */
    }
  }, [portalEmail]);

  useEffect(() => {
    if (!portalUser?.email) return undefined;
    fetchPortalNotifications();
    fetchQueueAttention();
    const sock = connectSocket("portal", portalUser.email);
    let timer = null;
    const refreshBadges = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        fetchPortalNotifications();
        fetchQueueAttention();
      }, 400);
    };
    sock.on("notification", refreshBadges);
    sock.on("data-refresh", refreshBadges);
    return () => {
      clearTimeout(timer);
      sock.off("notification", refreshBadges);
      sock.off("data-refresh", refreshBadges);
    };
  }, [portalUser?.email, fetchPortalNotifications, fetchQueueAttention]);

  useEffect(() => {
    if (!portalUser?.email || !shouldLoadPortalActivityData) return;
    const sock = connectSocket("portal", portalUser.email);
    const refreshMessages = (payload) => {
      if (
        !payload ||
        [
          "support_ticket_reply",
          "admin_message",
          "message_from_admin",
        ].includes(payload.type)
      ) {
        fetchSupportTickets();
      }
    };
    if (
      (supportDrawerOpen || messageDrawerOpen) &&
      !supportTicketsLoadAttemptedRef.current
    ) {
      fetchSupportTickets();
    }
    sock.on("notification", refreshMessages);
    sock.on("data-refresh", refreshMessages);
    return () => {
      sock.off("notification", refreshMessages);
      sock.off("data-refresh", refreshMessages);
    };
  }, [
    portalUser?.email,
    shouldLoadPortalActivityData,
    supportDrawerOpen,
    messageDrawerOpen,
    supportTickets.length,
    fetchSupportTickets,
  ]);

  const handleSubmitTicket = async (values) => {
    setSupportSubmitting(true);
    try {
      await api.post("/support-tickets", {
        portalUser: portalUser?._id,
        portalUserEmail: portalUser?.email,
        portalUserName: `${portalUser?.firstName} ${portalUser?.lastName}`,
        companyName: companyForm.getFieldValue("lguCompanyName") || "",
        slfName: activeSlfName,
        attachments: ticketAttachments,
        ...values,
      });
      Swal.fire({
        icon: "success",
        title: "Ticket Submitted",
        text: "Your concern has been submitted. Our team will review and respond.",
        confirmButtonColor: "#1a3353",
      });
      supportForm.resetFields();
      setTicketAttachments([]);
      fetchSupportTickets();
      setSupportTab("my-tickets");
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Failed",
        text: err.response?.data?.message || "Could not submit ticket.",
      });
    } finally {
      setSupportSubmitting(false);
    }
  };

  const handleSupportReply = async (ticketId) => {
    if (!supportReplyText.trim()) return;
    try {
      await api.post(`/support-tickets/${ticketId}/portal-reply`, {
        message: supportReplyText.trim(),
        repliedBy: portalUser?.email,
        repliedByName: `${portalUser?.firstName} ${portalUser?.lastName}`,
      });
      setSupportReplyText("");
      fetchSupportTickets();
      if (supportDetailModal) {
        const { data } = await api.get(`/support-tickets/${ticketId}`);
        setSupportDetailModal(data);
      }
    } catch {
      /* silent */
    }
  };

  return {
    fetchSupportTickets, getPortalNotificationMeta, handleSubmitTicket, handleSupportReply,
    isMessageNotification, isSupportNotification, markPortalNotificationRead,
    markPortalNotificationsRead, messageDrawerOpen, notificationPanelOpen, portalNotifications,
    portalUnreadCount, queueAttentionCount, setMessageDrawerOpen, setNotificationPanelOpen,
    setQueueAttentionCount, setSupportDetailModal, setSupportDrawerOpen, setSupportReplyText,
    setSupportTab, setTicketAttachments, supportDetailModal, supportDrawerOpen, supportLoading,
    supportReplyText, supportSubmitting, supportTab, supportTicketPagination, supportTicketSearch,
    supportTicketSorter, supportTickets, ticketAttachments,
  };
}
