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

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Typography, Space, Tooltip, Alert, Badge } from "antd";
import {
  SendOutlined, CloseOutlined, MessageOutlined, ReloadOutlined,
} from "@ant-design/icons";
import api from "../api";
import VeraFlameIcon from "./VeraFlameIcon";

const { Text } = Typography;
const MAX_INPUT = 500;
const HINT_TTL_MS = 13000;

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

export default function VeraAuthAssistant({ page = "portal-login" }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [meta, setMeta] = useState(null);
  const [hint, setHint] = useState(null);
  const scrollRef = useRef(null);
  const hintTimerRef = useRef(null);
  // Each issue nudges once per page visit. Held in a ref, not storage — an
  // anonymous visitor on a shared machine should leave nothing behind.
  const seenIssuesRef = useRef(new Set());

  // Starter content + greeting. Static and account-free, so it is safe to fetch
  // before sign-in.
  useEffect(() => {
    if (!open || meta) return;
    let cancelled = false;
    api
      .get("/vera/public-status")
      .then(({ data }) => {
        if (cancelled) return;
        setMeta(data);
        setMessages((m) => (m.length ? m : [{ role: "assistant", content: data.greeting }]));
      })
      .catch(() => {
        if (cancelled) return;
        setMeta({ enabled: true, supportEmail: "eswmr3@emb.gov.ph", starterQuestions: [] });
        setMessages((m) =>
          m.length
            ? m
            : [{ role: "assistant", content: "Hi, I'm VERA. Ask me about resetting your password or recovering your account." }],
        );
      });
    return () => { cancelled = true; };
  }, [open, meta]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending, open]);

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

  useEffect(() => {
    if (open) setHint(null);
  }, [open]);

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
            content: data?.answer || "I couldn't answer that. Please email eswmr3@emb.gov.ph.",
          },
        ]);
      } catch (err) {
        const status = err?.response?.status;
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content:
              status === 429
                ? err.response?.data?.message ||
                  "Too many messages just now — please wait a few minutes, or email eswmr3@emb.gov.ph."
                : `I couldn't reach the assistant service. For account help, email ${meta?.supportEmail || "eswmr3@emb.gov.ph"}.`,
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [input, sending, messages, page, meta],
  );

  if (!open) {
    return (
      <div className="vera-auth-dock">
        {hint && (
          // Live region so a screen reader announces the offer of help rather than
          // it being purely visual.
          <div className="vera-auth-hint" role="status" aria-live="polite">
            <button
              type="button"
              className="vera-auth-hint-body"
              onClick={() => { setOpen(true); setInput(hint.ask.slice(0, MAX_INPUT)); }}
            >
              <VeraFlameIcon size={16} />
              <span>{hint.text}</span>
            </button>
            <button
              type="button"
              className="vera-auth-hint-x"
              aria-label="Dismiss VERA suggestion"
              onClick={(e) => { e.stopPropagation(); setHint(null); }}
            >
              <CloseOutlined />
            </button>
          </div>
        )}
        <Tooltip
          title={hint ? hint.text : "Need help signing in or recovering your account? Ask VERA"}
          placement="left"
          open={hint ? false : undefined}
        >
          <Badge dot={!!hint} color="#ff4d4f" offset={[-6, 6]}>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open VERA account help"
              className={`vera-auth-fab${hint ? " has-issue" : ""}`}
            >
              <VeraFlameIcon size={26} anime />
            </button>
          </Badge>
        </Tooltip>
        <style>{dockCss}</style>
      </div>
    );
  }

  return (
    <div className="vera-auth-panel" role="dialog" aria-label="VERA account help">
      <div className="vera-auth-head">
        <Space size={8}>
          {/* Same reason as the button: the flame is a blue→teal→green gradient, so
              on the gradient header bar it disappeared. White disc behind it. */}
          <span className="vera-auth-head-icon">
            <VeraFlameIcon size={18} anime />
          </span>
          <Text strong style={{ color: "#fff" }}>VERA — Account Help</Text>
        </Space>
        <Space size={4}>
          <Tooltip title="Start over">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined style={{ color: "#fff" }} />}
              onClick={() => setMessages(meta?.greeting ? [{ role: "assistant", content: meta.greeting }] : [])}
              aria-label="Reset conversation"
            />
          </Tooltip>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined style={{ color: "#fff" }} />}
            onClick={() => setOpen(false)}
            aria-label="Close"
          />
        </Space>
      </div>

      <Alert
        type="info"
        showIcon={false}
        banner
        message={
          <Text style={{ fontSize: 11 }}>
            I can&apos;t look up accounts or confirm whether an email is registered. Never share a
            password or reset code here.
          </Text>
        }
        style={{ padding: "4px 10px" }}
      />

      <div className="vera-auth-body" ref={scrollRef}>
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "vera-auth-msg user" : "vera-auth-msg bot"}>
            {m.content}
          </div>
        ))}
        {sending && <div className="vera-auth-msg bot vera-auth-typing">VERA is thinking…</div>}
        {messages.length <= 1 && !sending && (meta?.starterQuestions || []).length > 0 && (
          <div className="vera-auth-starters">
            {meta.starterQuestions.map((q) => (
              <button key={q} type="button" onClick={() => send(q)}>{q}</button>
            ))}
          </div>
        )}
      </div>

      <div className="vera-auth-foot">
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="Describe the problem…"
          autoSize={{ minRows: 1, maxRows: 3 }}
          maxLength={MAX_INPUT}
          disabled={sending}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          loading={sending}
          onClick={() => send()}
          disabled={!input.trim()}
          aria-label="Send"
        />
      </div>
      <style>{panelCss}</style>
    </div>
  );
}

// Exported so an auth page can offer an inline prompt ("didn't get the code?")
// that opens this widget, optionally with the question pre-filled.
export function openVeraAuthHelp(ask) {
  window.dispatchEvent(new CustomEvent("vera:auth-open", { detail: { ask } }));
}

export function VeraAuthHelpLink({ children, ask }) {
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

/* Shared positioning contract for the collapsed dock and the open panel, so the
   panel opens exactly where the button was.

   z-index 900 is deliberate and sits BELOW antd's modal layer (1000): the auth
   pages open real modals (the credential prompt, the developer PIN dialog, the
   error card), and at 1200 the button floated ON TOP of their overlays.

   The bottom offset clears `.auth-page-footer` in Auth.css. On desktop that footer
   is `position: absolute; bottom: 16px` full-width centred text; below 992px it
   joins the normal flow at the page bottom, so the offset grows to clear it there.
   `env(safe-area-inset-bottom)` keeps the button off the iOS home indicator. */
const dockPosition = `
  position: fixed;
  right: max(20px, env(safe-area-inset-right, 0px));
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  z-index: 900;
`;

const dockCss = `
.vera-auth-dock {
  ${dockPosition}
  display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
  pointer-events: none;
}
.vera-auth-dock > * { pointer-events: auto; }

/* WHITE, not the brand gradient. VeraFlameIcon is itself a blue→teal→green
   gradient flame, so sitting it on a blue→teal→green button made the icon all but
   invisible. This matches how the in-portal launcher already handles it
   (.vera-launcher-icon in VeraChat.css): white disc, teal inset ring, colour moved
   to the shadow so the button still reads as VERA's. */
.vera-auth-fab {
  width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff;
  box-shadow:
    inset 0 0 0 2px rgba(19,194,194,0.30),
    0 6px 20px rgba(26,51,83,0.28);
  transition: transform .18s ease, box-shadow .18s ease;
}
.vera-auth-fab:hover {
  transform: translateY(-2px);
  box-shadow:
    inset 0 0 0 2px rgba(19,194,194,0.55),
    0 10px 26px rgba(26,51,83,0.34);
}
.vera-auth-fab:focus-visible { outline: 3px solid #91caff; outline-offset: 3px; }
.vera-auth-fab.has-issue {
  box-shadow:
    inset 0 0 0 2px rgba(255,77,79,0.45),
    0 6px 20px rgba(26,51,83,0.28);
  animation: veraAuthPulse 2s ease-in-out infinite;
}
@keyframes veraAuthPulse {
  0%, 100% { box-shadow: inset 0 0 0 2px rgba(255,77,79,0.45), 0 6px 20px rgba(26,51,83,0.28); }
  50%      { box-shadow: inset 0 0 0 2px rgba(255,77,79,0.85), 0 6px 26px rgba(255,77,79,0.45); }
}

/* Hint bubble. Width is capped against the viewport so it can never push the page
   sideways on a phone. */
.vera-auth-hint {
  display: flex; align-items: stretch; max-width: min(268px, calc(100vw - 40px));
  background: #fff; border: 1px solid #ffccc7; border-radius: 12px;
  box-shadow: 0 10px 28px rgba(16,38,64,0.20);
  overflow: hidden; animation: veraAuthHintIn .22s ease-out both;
}
.vera-auth-hint-body {
  display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;
  padding: 9px 10px; border: none; background: transparent; cursor: pointer;
  font-size: 12.5px; line-height: 1.35; color: #22364d; text-align: left;
}
.vera-auth-hint-body:hover { background: #fff1f0; }
.vera-auth-hint-x {
  border: none; background: transparent; cursor: pointer; padding: 0 8px;
  color: #8c8c8c; font-size: 11px; border-left: 1px solid #f0f0f0;
}
.vera-auth-hint-x:hover { color: #ff4d4f; }
@keyframes veraAuthHintIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Clear the stacked in-flow footer once Auth.css switches to a column layout. */
@media (max-width: 992px) {
  .vera-auth-dock { bottom: calc(58px + env(safe-area-inset-bottom, 0px)); }
}
@media (prefers-reduced-motion: reduce) {
  .vera-auth-fab, .vera-auth-hint { transition: none; animation: none; }
  .vera-auth-fab.has-issue { animation: none; }
}
`;

const panelCss = `
.vera-auth-panel {
  ${dockPosition}
  width: min(360px, calc(100vw - 32px));
  /* dvh, not vh: on mobile browsers vh ignores the collapsing toolbar and the
     on-screen keyboard, which pushed the input out of reach. */
  max-height: min(560px, calc(100dvh - 96px));
  display: flex; flex-direction: column; overflow: hidden;
  background: #fff; border-radius: 14px; border: 1px solid #e4ebf2;
  box-shadow: 0 18px 48px rgba(16,38,64,0.24);
}
@media (max-width: 992px) {
  .vera-auth-panel { bottom: calc(58px + env(safe-area-inset-bottom, 0px)); }
}
@media (max-width: 480px) {
  .vera-auth-panel {
    right: 12px; left: 12px; width: auto;
    max-height: min(70dvh, calc(100dvh - 110px));
  }
}
.vera-auth-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 12px;
  background: linear-gradient(135deg, #0958d9 0%, #13c2c2 100%);
}
.vera-auth-head-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 50%;
  background: #fff; box-shadow: inset 0 0 0 2px rgba(19,194,194,0.25);
}
.vera-auth-body {
  flex: 1; min-height: 180px; overflow-y: auto; padding: 12px;
  display: flex; flex-direction: column; gap: 8px; background: #fbfdff;
}
.vera-auth-msg {
  max-width: 86%; padding: 8px 11px; border-radius: 12px;
  font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word;
}
.vera-auth-msg.bot { align-self: flex-start; background: #fff; border: 1px solid #e4ebf2; color: #22364d; }
.vera-auth-msg.user { align-self: flex-end; background: #1677ff; color: #fff; }
.vera-auth-typing { color: #5a7089; font-style: italic; }
.vera-auth-starters { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.vera-auth-starters button {
  text-align: left; font-size: 12px; padding: 7px 10px; cursor: pointer;
  background: #fff; border: 1px dashed #91caff; border-radius: 9px; color: #0958d9;
}
.vera-auth-starters button:hover { background: #e6f4ff; }
.vera-auth-foot {
  display: flex; gap: 8px; align-items: flex-end;
  padding: 10px; border-top: 1px solid #e4ebf2; background: #fff;
}
.vera-auth-foot .ant-input { font-size: 13px; }
`;
