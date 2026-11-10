// VERA on the AUTH pages (sign-in, sign-up, password recovery).
//
// A locked-out user needs help at exactly the moment every other VERA surface is
// unreachable, because those all require a token. This widget talks to
// POST /api/vera/public-chat, which is deliberately the narrowest surface in the
// system: account-recovery guidance only, no database access, and no ability to
// confirm whether an email is registered.
//
// It is intentionally NOT the portal VeraChat: that component assumes an
// authenticated session (tickets, nudges, page context, persisted history). This one
// holds its conversation in component state only — nothing is written to storage,
// since an anonymous visitor on a shared machine should leave no trace behind.
//
// It LOOKS like the portal VeraChat, though — the EMBR3 UCDS VERA design, as UCDS
// shows on its own sign-in pages: the launcher pill inside a border beam, the
// dotted flame whose state follows what VERA is doing, and the introduction card
// for a sign-in problem the page reports. Styles: pages/SLFPortal/Vera/VeraChat.css
// (the `vera-root--auth` block carries the auth-page placement).

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Grid, theme as antdTheme } from "antd";
import {
  SendOutlined, CloseOutlined, MessageOutlined, ReloadOutlined,
} from "@ant-design/icons";
import { BorderBeam } from "border-beam";
import api from "../api";
import { VeraFlame } from "./vera/VeraMark";
import "../pages/SLFPortal/Vera/VeraChat.css";

const MAX_INPUT = 500;
const HINT_TTL_MS = 13000;
const SUPPORT_EMAIL = "eswmr3@emb.gov.ph";

// Contextual hints, keyed by the issue an auth page reports. `ask` is the question
// pre-loaded into the chat, so a stuck user reaches a real answer in one click
// rather than having to describe the problem themselves.
const ISSUE_HINTS = {
  login_failed: {
    text: "Trouble signing in? I can walk you through it.",
    ask: "I can't sign in even though I think my details are right. What should I check?",
  },
  rate_limited: {
    text: "Too many attempts locks sign-in briefly — here's why.",
    ask: "Why am I getting 'too many attempts' and how long do I wait?",
  },
  offline: {
    text: "Looks like a connection problem, not your password.",
    ask: "I appear to be offline. Is my account affected?",
  },
  maintenance: {
    text: "The portal is under maintenance — here's what still works.",
    ask: "The portal is under maintenance. What can I do in the meantime?",
  },
  code_failed: {
    text: "Reset code not working? Let's sort it out.",
    ask: "My reset code is invalid or expired. What now?",
  },
  code_sent: {
    text: "Code not arriving? I can help you track it down.",
    ask: "The reset code never arrived. What should I check?",
  },
  reset_failed: {
    text: "The reset didn't go through — I can explain why.",
    ask: "My password reset failed. What went wrong?",
  },
  signup_failed: {
    text: "Registration problem? Here's what to do.",
    ask: "My registration didn't go through. What should I do?",
  },
  recovery_unavailable: {
    text: "Password recovery is down — there is another route.",
    ask: "Password recovery is unavailable. How else can I get back in?",
  },
};

/**
 * Signal an auth problem to the VERA widget from anywhere on the page. The widget
 * surfaces a dismissible hint above its button and pre-loads a relevant question.
 * Safe to call unconditionally — a no-op when the widget is not mounted.
 */
export function reportVeraAuthIssue(kind) {
  if (!ISSUE_HINTS[kind]) return;
  window.dispatchEvent(new CustomEvent("vera:auth-issue", { detail: { kind } }));
}

// ── Shown or hidden per side ─────────────────────────────────────────────────
// Developer Settings › VERA & AI Agent has a switch for the admin sign-in pages
// and one for the SLF Portal's. /vera/public-status says which are on; it is
// fetched once per page load and shared by the widget and the help links, so a
// hidden VERA leaves no "Ask VERA" link pointing at nothing. Until it answers
// the widget stays hidden — a late launcher is better than one that flashes
// and disappears.
let publicStatusPromise = null;
const loadPublicStatus = () => {
  if (!publicStatusPromise) {
    publicStatusPromise = api
      .get("/vera/public-status")
      .then(({ data }) => data)
      .catch(() => {
        publicStatusPromise = null;
        return null;
      });
  }
  return publicStatusPromise;
};
const sideOf = (page) => (/^admin/i.test(String(page || "")) ? "admin" : "portal");
const visibleOn = (data, page) => {
  if (!data) return true; // status unreachable: keep the help available
  if (data.enabled === false) return false;
  return sideOf(page) === "admin" ? data.showOnAdminLogin !== false : data.showOnPortalLogin !== false;
};
// For the help links, which are not told their page: /slfportal/* is the portal.
const pageSide = () => (/^\/slfportal/i.test(window.location.pathname) ? "portal-auth" : "admin-auth");

function useVeraAuthVisible(page) {
  const [state, setState] = useState({ ready: false, visible: false, data: null });
  useEffect(() => {
    let alive = true;
    loadPublicStatus().then((data) => {
      if (alive) setState({ ready: true, visible: visibleOn(data, page), data });
    });
    return () => { alive = false; };
  }, [page]);
  return state;
}

export default function VeraAuthAssistant({ page = "portal-login" }) {
  const { visible, data: publicStatus } = useVeraAuthVisible(page);
  // The palette is derived from the app's accent, exactly as in the portal.
  // The auth pages are light-only, so the theme is fixed.
  const accent = antdTheme.useToken().token.colorPrimary;
  const screens = Grid.useBreakpoint();
  const isPhone = !screens.sm;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const [meta, setMeta] = useState(null);
  const [hint, setHint] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const launcherRef = useRef(null);
  const hintTimerRef = useRef(null);
  // Each issue nudges once per page visit. Held in a ref, not storage — an
  // anonymous visitor on a shared machine should leave nothing behind.
  const seenIssuesRef = useRef(new Set());

  // Starter content + greeting. Static and account-free, so it is safe to fetch
  // before sign-in.
  // Reuses the status already fetched for the visibility check.
  useEffect(() => {
    if (!open || meta) return;
    let cancelled = false;
    (publicStatus ? Promise.resolve(publicStatus) : loadPublicStatus()).then((data) => {
      if (cancelled) return;
      if (data) {
        setMeta(data);
        setMessages((m) => (m.length ? m : [{ role: "assistant", content: data.greeting }]));
        return;
      }
      setMeta({ enabled: true, supportEmail: SUPPORT_EMAIL, starterQuestions: [] });
      setMessages((m) =>
        m.length
          ? m
          : [{ role: "assistant", content: "Hi, I'm VERA. Ask me about resetting your password or recovering your account." }],
      );
    });
    return () => { cancelled = true; };
  }, [open, meta, publicStatus]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending, open]);

  // Focus the composer when the window opens.
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => inputRef.current?.focus?.(), 120);
    return () => clearTimeout(t);
  }, [open]);

  // Opened from elsewhere on the page (e.g. the "didn't get the code?" prompt on the
  // recovery screen), optionally seeded with the question already asked.
  useEffect(() => {
    const onOpen = (e) => {
      setOpen(true);
      setHint(null);
      const seed = e?.detail?.ask;
      if (seed) setInput(String(seed).slice(0, MAX_INPUT));
    };
    window.addEventListener("vera:auth-open", onOpen);
    return () => window.removeEventListener("vera:auth-open", onOpen);
  }, []);

  // Proactive hint when a page reports a problem. Suppressed while the chat is
  // already open (it would be pointing at a panel the user is looking at) and shown
  // at most once per issue kind per visit, so it stays a nudge and not a nag.
  useEffect(() => {
    const onIssue = (e) => {
      const kind = e?.detail?.kind;
      const cfg = ISSUE_HINTS[kind];
      if (!cfg || seenIssuesRef.current.has(kind)) return;
      seenIssuesRef.current.add(kind);
      setHint({ kind, ...cfg });
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => setHint(null), HINT_TTL_MS);
    };
    window.addEventListener("vera:auth-issue", onIssue);
    return () => {
      window.removeEventListener("vera:auth-issue", onIssue);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  const openChat = (seed) => {
    setHint(null);
    setOpen(true);
    if (seed) setInput(String(seed).slice(0, MAX_INPUT));
  };

  const closeChat = () => {
    setOpen(false);
    // Focus back to the launcher, so keyboard users are not stranded.
    requestAnimationFrame(() => launcherRef.current?.focus?.());
  };

  const send = useCallback(
    async (text) => {
      const msg = String(text ?? input).trim().slice(0, MAX_INPUT);
      if (!msg || sending) return;
      setInput("");
      setMessages((m) => [...m, { role: "user", content: msg }]);
      setSending(true);
      try {
        // Only the last few turns travel, purely for continuity — the server keeps
        // no transcript for anonymous callers.
        const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
        const { data } = await api.post("/vera/public-chat", { message: msg, history, page });
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: data?.answer || `I couldn't answer that. Please email ${SUPPORT_EMAIL}.`,
          },
        ]);
      } catch (err) {
        const status = err?.response?.status;
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            error: true,
            content:
              status === 429
                ? err.response?.data?.message ||
                  `Too many messages just now — please wait a few minutes, or email ${SUPPORT_EMAIL}.`
                : `I couldn't reach the assistant service. For account help, email ${meta?.supportEmail || SUPPORT_EMAIL}.`,
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [input, sending, messages, page, meta],
  );

  // One state for every flame: thinking while an answer is on its way,
  // listening while a question is typed, burning at rest.
  const flameState = sending ? "thinking" : inputFocused && input.trim() ? "listening" : "burning";
  const starters = meta?.starterQuestions || [];

  // Hidden on this side's sign-in pages (or not yet known): render nothing.
  if (!visible) return null;

  return (
    <div className="vera-root vera-root--auth" data-theme="light" style={{ "--v-app-accent": accent }}>
      {/* A sign-in problem the page reported, said from VERA's introduction
          card (the portal's floating card). */}
      {!open && hint && (
        <div className="vera-intro" role="status" aria-live="polite">
          <div className="vera-intro__head">
            <span className="vera-intro__mark">
              <VeraFlame size={40} state="working" theme="light" label="" />
            </span>
            <div className="vera-intro__who">
              <span className="vera-intro__name">VERA</span>
              <span className="vera-intro__role">Sign-in &amp; account help</span>
            </div>
            <button
              type="button"
              className="vera-icon-btn vera-intro__close"
              aria-label="Dismiss VERA suggestion"
              title="Dismiss"
              onClick={() => setHint(null)}
            >
              ×
            </button>
          </div>
          <p className="vera-intro__text">{hint.text}</p>
          <div className="vera-intro__actions">
            <button type="button" className="vera-intro__primary" onClick={() => openChat(hint.ask)}>
              Ask VERA
            </button>
            <button type="button" className="vera-intro__secondary" onClick={() => setHint(null)}>
              Not now
            </button>
          </div>
        </div>
      )}

      {!open && (
        // Red beam while a problem is being offered, so the launcher carries the
        // same signal as the card above it.
        <BorderBeam
          className={`vera-launcher-dock${hint ? " is-nudging" : ""}`}
          size="sm"
          colorVariant={hint ? "sunset" : "ocean"}
          theme="light"
          duration={2.6}
        >
          <button
            type="button"
            ref={launcherRef}
            className="vera-launcher"
            aria-label="Open VERA account help"
            onClick={() => openChat()}
          >
            <VeraFlame size={isPhone ? 40 : 36} state="burning" theme="light" glow={false} label="" />
            <span className="vera-launcher__text">
              <span className="vera-launcher__label">Ask VERA</span>
              <span className="vera-launcher__sub">Sign-in &amp; account help</span>
            </span>
          </button>
        </BorderBeam>
      )}

      {open && (
        <section
          className={`vera-window${isPhone ? " vera-window--mobile" : ""}`}
          role="dialog"
          aria-label="VERA account help"
          onKeyDown={(e) => {
            if (e.key === "Escape") closeChat();
          }}
        >
          <header className="vera-header">
            <div className="vera-header__id">
              <span className="vera-header__mark">
                <VeraFlame size={34} state={flameState} theme="light" label="" />
              </span>
              <div className="vera-header__text">
                <div className="vera-header__name">VERA</div>
                <div className="vera-header__sub">
                  <span className={`vera-status-dot vera-status-dot--${sending ? "busy" : "online"}`} />
                  {sending ? "Answering…" : "Sign-in & account help"}
                </div>
              </div>
            </div>
            <div className="vera-header__actions">
              <button
                type="button"
                className="vera-icon-btn"
                aria-label="Start over"
                title="Start over"
                onClick={() => setMessages(meta?.greeting ? [{ role: "assistant", content: meta.greeting }] : [])}
              >
                <ReloadOutlined />
              </button>
              <button type="button" className="vera-icon-btn" aria-label="Close" title="Close" onClick={closeChat}>
                <CloseOutlined />
              </button>
            </div>
          </header>

          <div className="vera-fullname">Virtual Environmental Response Assistant</div>

          <div className="vera-messages" ref={scrollRef} aria-live="polite">
            {messages.map((m, i) => (
              <div key={i} className={`vera-msg vera-msg--${m.role === "user" ? "user" : "assistant"}`}>
                <div className={`vera-bubble${m.error ? " vera-bubble--error" : ""}`} style={{ whiteSpace: "pre-wrap" }}>
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="vera-msg vera-msg--assistant">
                <div className="vera-bubble vera-thinking" aria-live="assertive">
                  <VeraFlame size={26} state="thinking" theme="light" label="" className="vera-thinking__mark" />
                  <span className="vera-thinking__text">VERA is thinking…</span>
                </div>
              </div>
            )}
            {messages.length <= 1 && !sending && starters.length > 0 && (
              <div className="vera-starters">
                <div className="vera-starters__label">Try asking:</div>
                {starters.map((q) => (
                  <button key={q} type="button" className="vera-starter-chip" onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            className="vera-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              ref={inputRef}
              className="vera-input"
              value={input}
              maxLength={MAX_INPUT}
              rows={1}
              placeholder="Describe the problem…"
              aria-label="Message to VERA"
              disabled={sending}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button type="submit" className="vera-send-btn" aria-label="Send" disabled={!input.trim() || sending}>
              <SendOutlined />
            </button>
          </form>

          <div className="vera-disclaimer">
            <MessageOutlined />
            <span>
              VERA can&apos;t look up accounts or confirm whether an email is registered. Never share a
              password or reset code here.
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

// Exported so an auth page can offer an inline prompt ("didn't get the code?")
// that opens this widget, optionally with the question pre-filled.
export function openVeraAuthHelp(ask) {
  window.dispatchEvent(new CustomEvent("vera:auth-open", { detail: { ask } }));
}

export function VeraAuthHelpLink({ children, ask }) {
  const { visible } = useVeraAuthVisible(pageSide());
  if (!visible) return null;
  return (
    <Button
      type="link"
      size="small"
      icon={<MessageOutlined />}
      style={{ padding: 0, fontSize: 13 }}
      onClick={() => openVeraAuthHelp(ask)}
    >
      {children}
    </Button>
  );
}
