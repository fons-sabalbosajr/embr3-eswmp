// VERA — Virtual Environmental Response Assistant (floating SLF Portal chatbot).
//
// Self-contained: manages its own open/minimize state, conversation, and API
// calls to /api/vera/chat. Renders assistant replies as PLAIN TEXT only (no HTML
// injection). Minimal conversation history is kept in sessionStorage. Ticket
// actions are delegated to the portal via props so the existing support flow is
// reused, not duplicated.

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  SendOutlined, CloseOutlined, MinusOutlined, DeleteOutlined,
  MessageOutlined, FileAddOutlined, ProfileOutlined, WarningOutlined,
  ReloadOutlined, QuestionCircleOutlined,
} from "@ant-design/icons";
import { animate, utils } from "animejs";
import api from "../../../api";
import VeraFlameIcon from "../../../components/VeraFlameIcon";
import "./VeraChat.css";

const STORAGE_KEY = "vera_chat_history";
const MAX_STORED = 30;
const MAX_INPUT = 1000;
const HISTORY_TURNS = 8;
const NUDGE_TTL_MS = 11000;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

// Contextual feature-recommendation nudges keyed by the current page. Kept generic
// and non-sensitive (guidance only). Admin vs portal chosen by the mount.
const CONTEXT_NUDGES = {
  portal: {
    overview: "I can help you read your dashboard and capacity gauges. Ask me anytime.",
    history: "Reviewing submissions? I can explain any status — pending, acknowledged, reverted, or rejected.",
    "data-entry": "Encoding baseline data or a submission? I can guide you through cells, haulers, and avoiding incomplete details.",
    requests: "Need to request an edit or revert? I can walk you through it.",
  },
  admin: {
    dashboard: "Need a hand reading the dashboard or SLF Location Map? Just ask.",
    "slf-waste-generators": "Reviewing submissions? I can walk you through acknowledging or reverting.",
    "slf-monitoring": "I can explain the capacity gauges and facility statuses on this page.",
    "settings-reports": "Generating a report? I can point you to the right filters first.",
  },
};

function newId() {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function VeraChat({
  activeMenu = "",
  isMobile = false,
  onOpenNewTicket = () => {},
  onOpenMyTickets = () => {},
  hideTicketActions = false, // admin mount: hide the portal-only ticket buttons
}) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [thinkStage, setThinkStage] = useState(0); // rotates the "thinking" wording
  const [status, setStatus] = useState({ mode: "fallback", starterQuestions: [], greeting: "" });
  const [errorText, setErrorText] = useState("");
  const [nudge, setNudge] = useState(null); // { id, text, cta } — contextual assist

  const nudgeRef = useRef(null);
  const launcherRef = useRef(null);
  const nudgeTimerRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const abortReasonRef = useRef(null); // "user" | "timeout" | null
  const lastUserTextRef = useRef("");   // for Retry
  const loadedStatus = useRef(false);

  // Rotating "thinking" status wording while a request is in flight. Text-only
  // (not motion), so it always runs; the flame glow provides the visual cue.
  const thinkingMessages = useMemo(
    () => [
      "VERA is thinking…",
      activeMenu ? "VERA is reviewing this page…" : "VERA is checking the help library…",
      "VERA is preparing the instructions…",
    ],
    [activeMenu],
  );
  useEffect(() => {
    if (!typing) { setThinkStage(0); return undefined; }
    const id = setInterval(() => setThinkStage((s) => (s + 1) % thinkingMessages.length), 2200);
    return () => clearInterval(id);
  }, [typing, thinkingMessages.length]);

  // Restore minimal history from sessionStorage once.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setMessages(parsed.slice(-MAX_STORED));
      }
    } catch { /* ignore */ }
  }, []);

  // Persist trimmed history.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED)));
    } catch { /* ignore */ }
  }, [messages]);

  // Auto-scroll to the newest message / typing indicator.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, typing, open, minimized]);

  // Open the (single) chat instance from anywhere in the app — e.g. the dashboard
  // VERA card dispatches window `vera:open`. Reuses this mounted chat, never a
  // duplicate.
  useEffect(() => {
    const onOpen = () => { setOpen(true); setMinimized(false); };
    window.addEventListener("vera:open", onOpen);
    return () => window.removeEventListener("vera:open", onOpen);
  }, []);

  // Show a contextual nudge — once per id per browser session, never while the
  // chat is open, and auto-dismissed so it stays non-intrusive.
  const showNudge = useCallback((id, text, cta) => {
    if (!id || !text) return;
    const key = `vera_nudge_${id}`;
    try { if (sessionStorage.getItem(key)) return; } catch { /* ignore */ }
    try { sessionStorage.setItem(key, "1"); } catch { /* ignore */ }
    setNudge({ id, text, cta });
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = setTimeout(() => setNudge(null), NUDGE_TTL_MS);
  }, []);

  const dismissNudge = useCallback(() => {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    setNudge(null);
  }, []);

  // Any part of the app can raise a data-driven nudge:
  //   window.dispatchEvent(new CustomEvent("vera:nudge",
  //     { detail: { id, text, cta } }))   // cta optional: true opens the chat
  useEffect(() => {
    const onNudge = (e) => {
      const d = e?.detail || {};
      showNudge(d.id, d.text, d.cta);
    };
    window.addEventListener("vera:nudge", onNudge);
    return () => window.removeEventListener("vera:nudge", onNudge);
  }, [showNudge]);

  // Contextual feature recommendation when the user lands on a page (only while
  // the chat is closed). Small delay so it doesn't fight the page transition.
  useEffect(() => {
    if (open || !activeMenu) return undefined;
    const realm = hideTicketActions ? "admin" : "portal";
    const text = CONTEXT_NUDGES[realm]?.[activeMenu];
    if (!text) return undefined;
    const t = setTimeout(() => showNudge(`ctx_${realm}_${activeMenu}`, text, true), 1400);
    return () => clearTimeout(t);
  }, [activeMenu, open, hideTicketActions, showNudge]);

  // Clear the auto-dismiss timer + hide the nudge as soon as the chat opens.
  useEffect(() => {
    if (open) dismissNudge();
  }, [open, dismissNudge]);

  useEffect(() => () => { if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current); }, []);

  // Anime.js: entrance pop for the nudge bubble + a gentle attention bob of the
  // launcher while a nudge is showing. Skipped under reduced motion.
  useEffect(() => {
    if (!nudge || reducedMotion()) return undefined;
    const created = [];
    if (nudgeRef.current) {
      created.push(animate(nudgeRef.current, {
        opacity: [0, 1], translateY: [10, 0], scale: [0.94, 1], duration: 360, ease: "outBack",
        onComplete: (self) => { try { utils.cleanInlineStyles(self); } catch { /* ignore */ } },
      }));
    }
    if (launcherRef.current) {
      created.push(animate(launcherRef.current, {
        translateY: [0, -5], duration: 900, ease: "inOutSine", loop: 4, alternate: true,
        onComplete: (self) => { try { utils.cleanInlineStyles(self); } catch { /* ignore */ } },
      }));
    }
    return () => created.forEach((a) => { try { a.pause?.(); a.revert?.(); } catch { /* ignore */ } });
  }, [nudge]);

  // Lazy-load VERA status (greeting + starter questions + mode) on first open.
  useEffect(() => {
    if (!open || loadedStatus.current) return;
    loadedStatus.current = true;
    api.get("/vera/status")
      .then((res) => setStatus(res.data || {}))
      .catch(() => setStatus((s) => ({ ...s })));
  }, [open]);

  // Focus the input when the window opens/expands.
  useEffect(() => {
    if (open && !minimized) {
      const t = setTimeout(() => inputRef.current?.focus?.(), 120);
      return () => clearTimeout(t);
    }
  }, [open, minimized]);

  // The actual request. Shared by send() and retryLast(). Appends the assistant
  // reply or a typed error bubble (with a `retry` flag) and always clears the
  // thinking state — so it never hangs indefinitely.
  const runRequest = useCallback(async (text) => {
    setErrorText("");
    setTyping(true);
    abortReasonRef.current = null;

    // History = prior user/assistant turns (state already includes the user msg).
    const history = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content }));

    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => { abortReasonRef.current = "timeout"; controller.abort(); }, 35000);

    try {
      const res = await api.post(
        "/vera/chat",
        { message: text, history, page: activeMenu },
        { signal: controller.signal },
      );
      const data = res.data || {};
      if (data.ok && data.answer) {
        setMessages((prev) => [...prev, { id: newId(), role: "assistant", content: data.answer, source: data.source }]);
      } else {
        setMessages((prev) => [...prev, {
          id: newId(), role: "assistant",
          content: data.message || "Sorry, I couldn't answer that right now. Please try again or open a support ticket.",
          source: "error", retry: true,
        }]);
      }
    } catch (err) {
      const canceled = err?.code === "ERR_CANCELED" || err?.name === "CanceledError";
      const byUser = abortReasonRef.current === "user";
      setMessages((prev) => [...prev, {
        id: newId(), role: "assistant",
        content: byUser
          ? "Request cancelled. Ask me anything whenever you're ready."
          : canceled
            ? "That request took too long and was stopped. You can retry."
            : "I'm having trouble reaching the assistant service. You can retry, or open a support ticket for direct help.",
        source: "error", retry: !byUser,
      }]);
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
      abortReasonRef.current = null;
      setTyping(false);
    }
  }, [messages, activeMenu]);

  const send = useCallback((raw) => {
    const text = String(raw ?? "").trim().slice(0, MAX_INPUT);
    if (!text || typing) return; // duplicate/concurrent submit guard
    lastUserTextRef.current = text;
    setMessages((prev) => [...prev, { id: newId(), role: "user", content: text }]);
    setInput("");
    runRequest(text);
  }, [typing, runRequest]);

  // Retry the last question without re-adding the user bubble; drop a trailing
  // error bubble first so the transcript stays clean.
  const retryLast = useCallback(() => {
    if (typing) return;
    const text = lastUserTextRef.current;
    if (!text) return;
    setMessages((prev) => (prev.length && prev[prev.length - 1].source === "error" ? prev.slice(0, -1) : prev));
    runRequest(text);
  }, [typing, runRequest]);

  // Cancel/abort the in-flight request (distinct from a timeout).
  const cancelRequest = useCallback(() => {
    if (abortRef.current) { abortReasonRef.current = "user"; abortRef.current.abort(); }
  }, []);

  const clearChat = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setErrorText("");
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  const closeWindow = useCallback(() => {
    setOpen(false);
    setMinimized(false);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  // Esc closes the window when focus is inside it.
  const onKeyDownShell = useCallback((e) => {
    if (e.key === "Escape") closeWindow();
  }, [closeWindow]);

  const starters = useMemo(
    () => (Array.isArray(status.starterQuestions) ? status.starterQuestions : []),
    [status.starterQuestions],
  );

  const showGreeting = messages.length === 0;

  return (
    <div className="vera-root">
      {/* Floating launcher + contextual nudge bubble */}
      {!open && (
        <>
          {nudge && (
            <div className="vera-nudge" ref={nudgeRef} role="status">
              <button type="button" className="vera-nudge-close" aria-label="Dismiss" onClick={dismissNudge}>×</button>
              <span className="vera-nudge-icon"><VeraFlameIcon size={18} anime /></span>
              <div className="vera-nudge-body">
                <p className="vera-nudge-text">{nudge.text}</p>
                {nudge.cta && (
                  <button
                    type="button"
                    className="vera-nudge-cta"
                    onClick={() => { dismissNudge(); setOpen(true); setMinimized(false); }}
                  >
                    Yes, guide me
                  </button>
                )}
              </div>
            </div>
          )}
          <button
            type="button"
            ref={launcherRef}
            className="vera-launcher"
            aria-label="Open VERA, the Virtual Environmental Response Assistant"
            onClick={() => { setOpen(true); setMinimized(false); }}
          >
            <span className="vera-launcher-icon"><VeraFlameIcon size={24} /></span>
            <span className="vera-launcher-label">Ask VERA</span>
          </button>
        </>
      )}

      {/* Chat window */}
      {open && (
        <section
          className={`vera-window${minimized ? " vera-window-min" : ""}${isMobile ? " vera-window-mobile" : ""}`}
          role="dialog"
          aria-label="VERA assistant chat"
          onKeyDown={onKeyDownShell}
        >
          <header className="vera-header">
            <div className="vera-header-id">
              <span className="vera-header-icon"><VeraFlameIcon size={22} /></span>
              <div className="vera-header-text">
                <div className="vera-header-name">VERA</div>
                <div className="vera-header-sub">
                  <span className={`vera-status-dot ${status.mode === "model" ? "online" : "lite"}`} />
                  {status.mode === "model" ? "Online" : "Online · Help library"}
                </div>
              </div>
            </div>
            <div className="vera-header-actions">
              <button
                type="button"
                className="vera-icon-btn"
                aria-label="About VERA"
                title="About VERA"
                onClick={() => window.dispatchEvent(new CustomEvent("vera:onboarding"))}
              >
                <QuestionCircleOutlined />
              </button>
              <button
                type="button"
                className="vera-icon-btn"
                aria-label={minimized ? "Expand chat" : "Minimize chat"}
                onClick={() => setMinimized((m) => !m)}
              >
                <MinusOutlined />
              </button>
              <button
                type="button"
                className="vera-icon-btn"
                aria-label="Close chat"
                onClick={closeWindow}
              >
                <CloseOutlined />
              </button>
            </div>
          </header>

          {!minimized && (
            <>
              <div className="vera-full-name">Virtual Environmental Response Assistant</div>

              <div className="vera-messages" ref={scrollRef} aria-live="polite">
                {showGreeting && (
                  <div className="vera-msg vera-msg-assistant">
                    <div className="vera-bubble">
                      {status.greeting ||
                        "Hi! I'm VERA, your Virtual Environmental Response Assistant. Ask me about submitting disposal data, baselines, haulers, organizing cells, statuses, uploads, or common errors."}
                    </div>
                  </div>
                )}

                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`vera-msg ${m.role === "user" ? "vera-msg-user" : "vera-msg-assistant"}`}
                  >
                    <div className={`vera-bubble${m.source === "error" ? " vera-bubble-error" : ""}`}>
                      {m.source === "error" && <WarningOutlined className="vera-bubble-warn" />}
                      {m.content}
                      {m.retry && !typing && (
                        <button type="button" className="vera-retry-btn" onClick={retryLast}>
                          <ReloadOutlined /> Retry
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {typing && (
                  <div className="vera-msg vera-msg-assistant">
                    <div className="vera-bubble vera-thinking" aria-live="assertive">
                      <span className="vera-thinking-flame"><VeraFlameIcon size={16} /></span>
                      <span className="vera-thinking-text">{thinkingMessages[thinkStage]}</span>
                      <span className="vera-typing" aria-hidden><span /><span /><span /></span>
                      <button type="button" className="vera-cancel-btn" onClick={cancelRequest} aria-label="Cancel request">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {showGreeting && starters.length > 0 && (
                  <div className="vera-starters">
                    <div className="vera-starters-label">Try asking:</div>
                    {starters.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className="vera-starter-chip"
                        onClick={() => send(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick actions — reuse the existing support ticket flow (portal only) */}
              <div className="vera-quick-actions">
                {!hideTicketActions && (
                  <>
                    <button type="button" className="vera-quick-btn" onClick={onOpenNewTicket}>
                      <FileAddOutlined /> Open a ticket
                    </button>
                    <button type="button" className="vera-quick-btn" onClick={onOpenMyTickets}>
                      <ProfileOutlined /> My tickets
                    </button>
                  </>
                )}
                {messages.length > 0 && (
                  <button type="button" className="vera-quick-btn vera-quick-clear" onClick={clearChat}>
                    <DeleteOutlined /> Clear
                  </button>
                )}
              </div>

              {errorText && <div className="vera-inline-error">{errorText}</div>}

              <form
                className="vera-input-row"
                onSubmit={(e) => { e.preventDefault(); send(input); }}
              >
                <textarea
                  ref={inputRef}
                  className="vera-input"
                  value={input}
                  maxLength={MAX_INPUT}
                  rows={1}
                  placeholder="Ask VERA about the SLF Portal…"
                  aria-label="Message to VERA"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                />
                <button
                  type="submit"
                  className="vera-send-btn"
                  aria-label="Send message"
                  disabled={!input.trim() || typing}
                >
                  <SendOutlined />
                </button>
              </form>

              <div className="vera-disclaimer">
                <MessageOutlined /> VERA gives guidance, not confirmed record data. Verify statuses in the portal.
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
