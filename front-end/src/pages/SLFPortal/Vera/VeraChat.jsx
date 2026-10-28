// VERA — Virtual Environmental Response Assistant (floating SLF Portal chatbot).
//
// The look is the EMBR3 UCDS VERA design: a launcher pill inside a border beam
// (border-beam, as in UCDS), the animated dotted flame whose state follows what
// VERA is doing (burning at rest, listening while you type, thinking /
// searching / working while an answer is on its way), and a palette derived
// from the app's own accent in light or dark. When VERA has something to say
// unprompted (a contextual nudge) she says it in UCDS's introduction card: her
// flame ignites, the message types itself out, then she settles. See
// VeraChat.css.
//
// Self-contained: manages its own open/minimize state, conversation, and API
// calls to /api/vera/chat. Renders assistant replies as PLAIN TEXT only (no HTML
// injection). Minimal conversation history is kept in sessionStorage, ENCRYPTED
// through secureStorage — a transcript can contain facility and submission
// details, and it previously sat there as readable plaintext JSON under an
// obvious key name. Ticket
// actions are delegated to the portal via props so the existing support flow is
// reused, not duplicated.

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  SendOutlined, CloseOutlined, MinusOutlined, DeleteOutlined,
  MessageOutlined, FileAddOutlined, ProfileOutlined, WarningOutlined,
  ReloadOutlined, QuestionCircleOutlined,
} from "@ant-design/icons";
import { theme as antdTheme } from "antd";
import { BorderBeam } from "border-beam";
import api from "../../../api";
import { VeraFlame } from "../../../components/vera/VeraMark";
import secureStorage from "../../../utils/secureStorage";
import { buildVeraPageContext } from "../../../utils/veraPageContext";
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

/**
 * VERA's answer, rendered as TEXT — never HTML — so a reply can never inject
 * markup. A small safe subset of Markdown is honoured: **bold**, `code`,
 * numbered and bulleted lists, paragraphs.
 */
function AnswerText({ children }) {
  const blocks = String(children || "").split(/\n{2,}/);
  const inline = (line, key) => (
    <span key={key}>
      {String(line)
        .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
        .map((part, i) => {
          if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
          if (/^`[^`]+`$/.test(part)) return <code key={i} className="vera-code">{part.slice(1, -1)}</code>;
          return <span key={i}>{part}</span>;
        })}
    </span>
  );
  return (
    <div className="vera-answer">
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim());
        const isList = lines.length > 0 && lines.every((l) => /^\s*(\d+[.)]|[-•*])\s+/.test(l));
        if (isList) {
          const ListTag = /^\s*\d+[.)]/.test(lines[0]) ? "ol" : "ul";
          return (
            <ListTag key={bi} className="vera-answer__list">
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*(\d+[.)]|[-•*])\s+/, ""), li)}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={bi} className="vera-answer__p">
            {lines.map((l, li) => (
              <span key={li}>
                {inline(l, li)}
                {li < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export default function VeraChat({
  activeMenu = "",
  isMobile = false,
  onOpenNewTicket = () => {},
  onOpenMyTickets = () => {},
  hideTicketActions = false, // admin mount: hide the portal-only ticket buttons
  theme = "light", // the app's mode — the palette and the flame follow it
}) {
  // The palette is derived from the app's own accent (VeraChat.css), so VERA
  // matches whichever primary colour the admin has chosen.
  const accent = antdTheme.useToken().token.colorPrimary;
  const mode = theme === "dark" ? "dark" : "light";
  const [inputFocused, setInputFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [thinkStage, setThinkStage] = useState(0); // rotates the "thinking" wording
  const [status, setStatus] = useState({ mode: "fallback", starterQuestions: [], greeting: "" });
  const [errorText, setErrorText] = useState("");
  const [nudge, setNudge] = useState(null); // { id, text, cta } — contextual assist
  // The floating card's typed length and its flame, reset by showNudge.
  const [typed, setTyped] = useState(0);
  const [introFlame, setIntroFlame] = useState("igniting");

  const launcherRef = useRef(null);
  const nudgeTimerRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const abortReasonRef = useRef(null); // "user" | "timeout" | null
  const lastUserTextRef = useRef("");   // for Retry
  const loadedStatus = useRef(false);
  const pendingAskRef = useRef("");     // question seeded by a `vera:open` event

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
      const parsed = secureStorage.sessionGetJSON(STORAGE_KEY);
      if (Array.isArray(parsed)) setMessages(parsed.slice(-MAX_STORED));
    } catch { /* ignore */ }
  }, []);

  // Persist trimmed history.
  useEffect(() => {
    try {
      secureStorage.sessionSetJSON(STORAGE_KEY, messages.slice(-MAX_STORED));
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
    const onOpen = (event) => {
      setOpen(true);
      setMinimized(false);
      // `detail.ask` seeds a question — used by the feature tour's "Ask VERA",
      // so the user lands in a conversation already underway instead of an
      // empty chat they have to think of a question for. Queued in a ref and
      // sent by the effect below, because `send` guards on `typing` and would
      // drop a call made during this handler's render pass.
      const ask = String(event?.detail?.ask || "").trim();
      if (ask) pendingAskRef.current = ask;
    };
    window.addEventListener("vera:open", onOpen);
    return () => window.removeEventListener("vera:open", onOpen);
  }, []);

  // Show a contextual nudge — once per id per browser session, never while the
  // chat is open, and auto-dismissed so it stays non-intrusive.
  const showNudge = useCallback((id, text, cta) => {
    if (!id || !text) return;
    const key = `vera_nudge_${id}`;
    try { if (secureStorage.sessionGet(key)) return; } catch { /* ignore */ }
    try { secureStorage.sessionSet(key, "1"); } catch { /* ignore */ }
    setNudge({ id, text, cta });
    // Under reduced motion the message is simply there and the flame at rest.
    const still = reducedMotion();
    setTyped(still ? String(text).length : 0);
    setIntroFlame(still ? "burning" : "igniting");
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

  // The nudge card speaks (UCDS introduction): her flame ignites, the message
  // types itself out while she "speaks", then the flame settles to burning.
  const nudgeText = nudge?.text || "";
  useEffect(() => {
    if (!nudge || reducedMotion()) return undefined;
    const lit = setTimeout(() => setIntroFlame("working"), 1200);
    const tick = setInterval(() => setTyped((n) => (n >= nudgeText.length ? n : n + 2)), 28);
    return () => {
      clearTimeout(lit);
      clearInterval(tick);
    };
  }, [nudge, nudgeText.length]);
  const speaking = Boolean(nudge) && typed < nudgeText.length;
  useEffect(() => {
    if (!nudge || speaking) return undefined;
    const t = setTimeout(() => setIntroFlame("burning"), 600);
    return () => clearTimeout(t);
  }, [nudge, speaking]);

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
        // Snapshot of the data currently rendered, so a question about something
        // visible on screen is answered from it instead of being refused as "live
        // data I can't see". Null when the page has no data worth sending.
        { message: text, history, page: activeMenu, pageContext: buildVeraPageContext(text, activeMenu) },
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

  // Send a question seeded by `vera:open`, once the chat is actually open and
  // idle. Cleared before sending so a re-render can never ask it twice.
  useEffect(() => {
    if (!open || minimized || typing) return;
    const ask = pendingAskRef.current;
    if (!ask) return;
    pendingAskRef.current = "";
    send(ask);
  }, [open, minimized, typing, send]);

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
    try { secureStorage.sessionRemove(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  const closeWindow = useCallback(() => {
    setOpen(false);
    setMinimized(false);
    if (abortRef.current) abortRef.current.abort();
    // Focus back to the launcher, so keyboard users are not stranded.
    requestAnimationFrame(() => launcherRef.current?.focus?.());
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

  // One state for every flame on screen: the stage of a pending answer
  // (thinking → checking → preparing), listening while a question is being
  // typed, burning at rest. The dot-by-dot hand-off from the orb back to the
  // flame is what an arriving answer looks like.
  const flameState = typing
    ? ["thinking", "searching", "working"][thinkStage % 3]
    : inputFocused && input.trim()
      ? "listening"
      : "burning";
  const modelOn = status.mode === "model";

  return (
    // data-theme scopes the palette in VeraChat.css and is the [data-theme] the
    // canvases fall back to; --v-app-accent is the app's primary colour.
    <div className="vera-root" data-theme={mode} style={{ "--v-app-accent": accent }}>
      {/* VERA's floating card: a contextual nudge, said the way UCDS's VERA
          introduces herself. On the portal the Messages button sits between
          the card and the launcher, so the card is lifted above both and
          drops the tail that would otherwise point at Messages. */}
      {!open && nudge && (
        <div className={`vera-intro${hideTicketActions ? "" : " vera-intro--stacked"}`} role="status">
          <div className="vera-intro__head">
            <span className={`vera-intro__mark${speaking ? " is-speaking" : ""}`}>
              <VeraFlame size={44} state={introFlame} theme={mode} label="" />
            </span>
            <div className="vera-intro__who">
              <span className="vera-intro__name">VERA</span>
              <span className="vera-intro__role">Virtual Environmental Response Assistant</span>
            </div>
            <button type="button" className="vera-icon-btn vera-intro__close" aria-label="Dismiss" title="Dismiss" onClick={dismissNudge}>
              ×
            </button>
          </div>
          {/* Screen readers get the whole message once, not every typed frame. */}
          <span className="vera-sr-only">{nudgeText}</span>
          <p className="vera-intro__text" aria-hidden="true">
            {nudgeText.slice(0, typed)}
            {speaking ? <span className="vera-intro__caret" /> : null}
          </p>
          {nudge.cta && (
            <div className="vera-intro__actions">
              <button
                type="button"
                className="vera-intro__primary"
                onClick={() => { dismissNudge(); setOpen(true); setMinimized(false); }}
              >
                Yes, guide me
              </button>
              <button type="button" className="vera-intro__secondary" onClick={dismissNudge}>
                Maybe later
              </button>
            </div>
          )}
        </div>
      )}

      {!open && (
        // The beam's box (border-beam, as in UCDS) is what sits fixed in the
        // corner; the button inside it takes the beam's shape.
        <BorderBeam
          className={`vera-launcher-dock${nudge ? " is-nudging" : ""}`}
          size="sm"
          colorVariant="ocean"
          theme={mode}
          duration={2.6}
        >
          <button
            type="button"
            ref={launcherRef}
            className="vera-launcher"
            aria-label="Open VERA, the Virtual Environmental Response Assistant"
            onClick={() => { setOpen(true); setMinimized(false); }}
          >
            <VeraFlame size={isMobile ? 40 : 36} state="burning" theme={mode} glow={false} label="" />
            <span className="vera-launcher__text">
              <span className="vera-launcher__label">Ask VERA</span>
              <span className="vera-launcher__sub">
                {hideTicketActions ? "Your ESWMP assistant" : "Your SLF Portal assistant"}
              </span>
            </span>
          </button>
        </BorderBeam>
      )}

      {/* Chat window */}
      {open && (
        <section
          className={["vera-window", minimized ? "vera-window--min" : "", isMobile ? "vera-window--mobile" : ""].filter(Boolean).join(" ")}
          role="dialog"
          aria-label="VERA assistant chat"
          onKeyDown={onKeyDownShell}
        >
          <header className="vera-header">
            <div className="vera-header__id">
              <span className="vera-header__mark">
                <VeraFlame size={34} state={flameState} theme={mode} label="" />
              </span>
              <div className="vera-header__text">
                <div className="vera-header__name">VERA</div>
                <div className="vera-header__sub">
                  <span className={`vera-status-dot vera-status-dot--${typing ? "busy" : modelOn ? "online" : "lite"}`} />
                  {typing ? "Answering…" : modelOn ? "Online" : "Online · Help library"}
                </div>
              </div>
            </div>
            <div className="vera-header__actions">
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
                title={minimized ? "Expand" : "Minimize"}
                onClick={() => setMinimized((m) => !m)}
              >
                <MinusOutlined />
              </button>
              <button
                type="button"
                className="vera-icon-btn"
                aria-label="Close chat"
                title="Close"
                onClick={closeWindow}
              >
                <CloseOutlined />
              </button>
            </div>
          </header>

          {!minimized && (
            <>
              <div className="vera-fullname">Virtual Environmental Response Assistant</div>

              <div className="vera-messages" ref={scrollRef} aria-live="polite">
                {showGreeting && (
                  <div className="vera-msg vera-msg--assistant">
                    <div className="vera-bubble">
                      <AnswerText>
                        {status.greeting ||
                          "Hi! I'm VERA, your Virtual Environmental Response Assistant. Ask me about submitting disposal data, baselines, haulers, organizing cells, statuses, uploads, or common errors."}
                      </AnswerText>
                    </div>
                  </div>
                )}

                {messages.map((m) => (
                  <div key={m.id} className={`vera-msg vera-msg--${m.role === "user" ? "user" : "assistant"}`}>
                    <div className={`vera-bubble${m.source === "error" ? " vera-bubble--error" : ""}`}>
                      {m.role === "user" ? (
                        <span>{m.content}</span>
                      ) : (
                        <>
                          {m.source === "error" && <WarningOutlined className="vera-bubble__warn" />}
                          <AnswerText>{m.content}</AnswerText>
                          {m.retry && !typing && (
                            <button type="button" className="vera-retry-btn" onClick={retryLast}>
                              <ReloadOutlined /> Retry
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}

                {typing && (
                  <div className="vera-msg vera-msg--assistant">
                    <div className="vera-bubble vera-thinking" aria-live="assertive">
                      <VeraFlame size={26} state={flameState} theme={mode} label="" className="vera-thinking__mark" />
                      <span className="vera-thinking__text">{thinkingMessages[thinkStage]}</span>
                      <button type="button" className="vera-cancel-btn" onClick={cancelRequest} aria-label="Cancel request">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {showGreeting && starters.length > 0 && (
                  <div className="vera-starters">
                    <div className="vera-starters__label">Try asking:</div>
                    {starters.map((q) => (
                      <button key={q} type="button" className="vera-starter-chip" onClick={() => send(q)} disabled={typing}>
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick actions — reuse the existing support ticket flow (portal only) */}
              {(!hideTicketActions || messages.length > 0) && (
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
                    <button type="button" className="vera-quick-btn vera-quick-btn--clear" onClick={clearChat} disabled={typing}>
                      <DeleteOutlined /> Clear
                    </button>
                  )}
                </div>
              )}

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
                  placeholder={hideTicketActions ? "Ask VERA how to do something…" : "Ask VERA about the SLF Portal…"}
                  aria-label="Message to VERA"
                  onChange={(e) => setInput(e.target.value)}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
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
                <MessageOutlined />
                <span>VERA gives guidance, not confirmed record data. Verify statuses in the portal.</span>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
