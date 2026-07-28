// VERA onboarding — a first-login introduction modal for both portals. A
// user-controlled (never autoplay) carousel of 5 slides that explains who VERA
// is, what it can/can't do, privacy, and how to start. Reuses the shared animated
// flame. Shows once per authenticated user + portal (localStorage); reopenable via
// the `vera:onboarding` event (dispatched by the VERA chat header "?" button).
//
// Never blocks portal use: if anything here throws, the portal keeps working.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Button, Carousel, Typography, Checkbox, notification } from "antd";
import {
  SendOutlined, FormOutlined, CalendarOutlined, SafetyCertificateOutlined,
  InfoCircleOutlined, WarningOutlined, CheckCircleOutlined, DashboardOutlined,
  AuditOutlined, TeamOutlined, EnvironmentOutlined, RocketOutlined, LockOutlined,
} from "@ant-design/icons";
import VeraFlameIcon from "./VeraFlameIcon";
import getOnboarding from "./veraOnboardingContent";

const { Text, Paragraph } = Typography;

const ICONS = {
  send: <SendOutlined />, form: <FormOutlined />, calendar: <CalendarOutlined />,
  safety: <SafetyCertificateOutlined />, status: <InfoCircleOutlined />, warn: <WarningOutlined />,
  check: <CheckCircleOutlined />, dashboard: <DashboardOutlined />, audit: <AuditOutlined />,
  team: <TeamOutlined />, map: <EnvironmentOutlined />,
};

// Explicit "Do not show again" preference — the ONLY thing that suppresses the
// full intro. Persisted in localStorage per portal + user so it survives refresh,
// logout and re-login (never only in React state). NB: this is intentionally a
// NEW key, separate from the legacy `vera_onboarding_seen_*` flag. The old flag
// was set on ANY dismissal, which is exactly the bug being fixed (the intro
// vanished after a single view even without opting out); it is deliberately not
// read here so users who never opted out see the intro again until they choose to.
const dontShowKey = (portal, userId) => `vera_onboarding_dontshow_${portal}_${userId || "anon"}`;
// Guards the top-right notification to once per login/browser session (sessionStorage
// clears on logout→login of a fresh tab, so the reminder shows once per session).
const notifiedKey = (portal, userId) => `vera_onboarding_notified_${portal}_${userId || "anon"}`;
// Guards the full intro popup to once per browser session, so that after the user
// dismisses OR skips it, it never re-appears on re-renders/identity changes within
// the same session (it still returns on the next login unless "Do not show again").
const shownKey = (portal, userId) => `vera_onboarding_shown_${portal}_${userId || "anon"}`;

export default function VeraOnboarding({ portal = "slf", userId }) {
  const [open, setOpen] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const carouselRef = useRef(null);
  const content = useMemo(() => getOnboarding(portal), [portal]);
  const key = dontShowKey(content.portal, userId);

  // Post-login behaviour, driven purely by the persisted preference:
  //  • preference NOT set → show the full intro popup every login (until opted out)
  //  • preference set      → skip the popup and instead surface a small top-right
  //    auto-closing notification (once per session). The two are mutually exclusive
  //    by construction, so the popup and the top-right alert never both appear.
  useEffect(() => {
    if (!userId) return; // wait until we know who the user is
    let dismissed = false;
    try { dismissed = !!localStorage.getItem(key); } catch { /* storage blocked */ }
    // Once shown (and then closed/skipped) this session, never auto-reopen — even
    // if this effect re-runs because the user identity object changed reference.
    let shownThisSession = false;
    const sk = shownKey(content.portal, userId);
    try { shownThisSession = !!sessionStorage.getItem(sk); } catch { /* storage blocked */ }
    if (!dismissed && !shownThisSession) {
      try { sessionStorage.setItem(sk, "1"); } catch { /* best-effort */ }
      setDontShow(false);
      setOpen(true);
      return;
    }
    if (!dismissed) return; // shown already this session; wait for next login
    // Opted out: reflect the persisted preference in the checkbox and show the
    // lightweight reminder once for this session.
    setDontShow(true);
    try {
      const nk = notifiedKey(content.portal, userId);
      if (!sessionStorage.getItem(nk)) {
        sessionStorage.setItem(nk, "1");
        notification.open({
          key: nk,
          message: "VERA",
          description: "VERA is active and monitoring your portal data for issues.",
          placement: "topRight",
          duration: 4,
          icon: <VeraFlameIcon size={22} />,
        });
      }
    } catch { /* notification/storage best-effort — never block the portal */ }
  }, [key, content.portal, userId]);

  // Reopen on demand (VERA header "?"). Always opens, regardless of the preference.
  useEffect(() => {
    const onReopen = () => setOpen(true);
    window.addEventListener("vera:onboarding", onReopen);
    return () => window.removeEventListener("vera:onboarding", onReopen);
  }, []);

  // Persist / clear the explicit opt-out preference (reversible — unchecking
  // restores the intro on the next login).
  const setDontShowPref = useCallback(
    (checked) => {
      try {
        if (checked) localStorage.setItem(key, new Date().toISOString());
        else localStorage.removeItem(key);
      } catch { /* ignore */ }
    },
    [key],
  );

  // Closing/skipping WITHOUT opting out does NOT persist anything, so the intro
  // returns on the next login. Only the "Do not show again" checkbox suppresses it.
  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const askVera = useCallback(() => {
    close();
    window.dispatchEvent(new CustomEvent("vera:open"));
  }, [close]);

  const slides = useMemo(() => {
    const heroTitle = "VERA";
    const fullName = "Virtual Environmental Response Assistant";
    return [
      // 1 — Meet VERA
      {
        key: "meet",
        render: () => (
          <div className="vera-ob-slide vera-ob-hero">
            <div className="vera-ob-hero-icon"><VeraFlameIcon size={56} anime /></div>
            <div className="vera-ob-hero-name">{heroTitle}</div>
            <Text type="secondary" className="vera-ob-hero-full">{fullName}</Text>
            <Paragraph className="vera-ob-lead">{content.tagline}. {content.purpose}</Paragraph>
          </div>
        ),
      },
      // 2 — What VERA Can Do
      {
        key: "cando",
        render: () => (
          <div className="vera-ob-slide">
            <div className="vera-ob-slide-title"><RocketOutlined /> What VERA Can Do</div>
            <div className="vera-ob-cards">
              {content.canDo.map((c) => (
                <div key={c.title} className="vera-ob-card">
                  <span className="vera-ob-card-icon">{ICONS[c.icon] || <InfoCircleOutlined />}</span>
                  <div>
                    <div className="vera-ob-card-title">{c.title}</div>
                    <div className="vera-ob-card-text">{c.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ),
      },
      // 3 — How VERA Helps You
      {
        key: "helps",
        render: () => (
          <div className="vera-ob-slide">
            <div className="vera-ob-slide-title"><InfoCircleOutlined /> How VERA Helps You</div>
            <ul className="vera-ob-list">
              {content.helps.map((h) => <li key={h}>{h}</li>)}
            </ul>
            <Text type="secondary" className="vera-ob-note">
              Tip: open VERA anytime with the floating flame button, bottom-right.
            </Text>
          </div>
        ),
      },
      // 4 — Privacy & Limitations
      {
        key: "privacy",
        render: () => (
          <div className="vera-ob-slide">
            <div className="vera-ob-slide-title"><LockOutlined /> Privacy &amp; Limitations</div>
            <Paragraph className="vera-ob-lead">{content.privacy}</Paragraph>
            <div className="vera-ob-slide-subtitle">VERA won't:</div>
            <ul className="vera-ob-list">
              {content.cannotDo.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
        ),
      },
      // 5 — Start Asking VERA
      {
        key: "start",
        render: () => (
          <div className="vera-ob-slide vera-ob-hero">
            <div className="vera-ob-hero-icon"><VeraFlameIcon size={48} anime /></div>
            <div className="vera-ob-slide-title" style={{ justifyContent: "center" }}>Start Asking VERA</div>
            <Paragraph className="vera-ob-lead" style={{ textAlign: "center" }}>
              Type a question, tap a suggested starter, or ask “What can you help me with?”. VERA is ready whenever you are.
            </Paragraph>
          </div>
        ),
      },
    ];
  }, [content]);

  const go = (dir) => {
    const c = carouselRef.current;
    if (!c) return;
    if (dir < 0) c.prev(); else c.next();
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      centered
      width="min(680px, 96vw)"
      styles={{ body: { padding: 0 } }}
      footer={null}
      aria-label="Introducing VERA"
      destroyOnHidden
      classNames={{ content: "vera-ob-modal" }}
    >
      <div className="vera-ob-root">
        <Carousel ref={carouselRef} dots infinite={false} draggable adaptiveHeight>
          {slides.map((s) => <div key={s.key}>{s.render()}</div>)}
        </Carousel>

        <div className="vera-ob-footer">
          <Checkbox
            checked={dontShow}
            onChange={(e) => {
              const checked = e.target.checked;
              setDontShow(checked);
              setDontShowPref(checked);
            }}
          >
            Do not show again
          </Checkbox>
          <div className="vera-ob-footer-actions">
            <Button onClick={close}>Skip</Button>
            <Button onClick={() => go(1)}>Explore Features</Button>
            <Button type="primary" onClick={askVera} className="vera-ob-cta">Ask VERA</Button>
          </div>
        </div>
      </div>

      <style>{`
        .vera-ob-modal .ant-modal-body { border-radius: 14px; overflow: hidden; }
        .vera-ob-root { border-radius: 14px; overflow: hidden; }
        .vera-ob-slide { padding: 26px 28px 8px; min-height: 240px; }
        .vera-ob-hero { text-align: center; display: flex; flex-direction: column; align-items: center; }
        .vera-ob-hero-icon {
          width: 84px; height: 84px; border-radius: 50%; display: inline-flex;
          align-items: center; justify-content: center; margin-bottom: 8px;
          background: radial-gradient(circle at 50% 40%, rgba(19,194,194,0.15), rgba(22,119,255,0.06));
          box-shadow: inset 0 0 0 2px rgba(19,194,194,0.25);
        }
        .vera-ob-hero-name { font-size: 26px; font-weight: 800; letter-spacing: 1px; color: #14243b; }
        .vera-ob-hero-full { font-size: 12.5px; }
        .vera-ob-lead { margin-top: 12px !important; font-size: 14px; color: #33475b; }
        .vera-ob-slide-title { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 700; color: #14243b; margin-bottom: 14px; }
        .vera-ob-slide-subtitle { font-weight: 600; margin: 10px 0 4px; color: #33475b; }
        .vera-ob-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
        .vera-ob-card { display: flex; gap: 10px; padding: 10px 12px; border: 1px solid #e4ebf2; border-radius: 10px; background: #fbfdff; }
        .vera-ob-card-icon {
          flex: 0 0 auto; width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, rgba(22,119,255,0.12), rgba(82,196,26,0.14)); color: #0958d9; font-size: 15px;
        }
        .vera-ob-card-title { font-weight: 600; font-size: 13px; color: #14243b; }
        .vera-ob-card-text { font-size: 11.5px; color: #5a7089; line-height: 1.35; }
        .vera-ob-list { margin: 4px 0 8px 18px; padding: 0; }
        .vera-ob-list li { font-size: 13px; color: #33475b; margin-bottom: 6px; line-height: 1.4; }
        .vera-ob-note { display: block; margin-top: 8px; font-size: 12px; }
        .vera-ob-footer {
          display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
          padding: 14px 20px; border-top: 1px solid #e4ebf2; background: #fff;
        }
        .vera-ob-footer-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .vera-ob-cta { border: none; background: linear-gradient(135deg, #1677ff 0%, #13c2c2 55%, #52c41a 100%); font-weight: 600; }
        .vera-ob-modal .ant-carousel .slick-dots li button { background: #1677ff; }
        .vera-ob-modal .ant-carousel .slick-dots li.slick-active button { background: #52c41a; }
        @media (max-width: 576px) {
          .vera-ob-slide { padding: 20px 16px 6px; }
          .vera-ob-cards { grid-template-columns: 1fr; }
          .vera-ob-footer { justify-content: center; }
        }
        @media (prefers-reduced-motion: reduce) {
          .vera-ob-modal .ant-carousel .slick-slide { transition: none !important; }
        }
      `}</style>
    </Modal>
  );
}
