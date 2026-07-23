// Shared VERA flame icon — a blue→teal→green gradient flame with a subtle,
// professional "alive" animation (soft glow pulse + gentle flicker). Reused
// across every VERA surface (floating launcher, chat header, dashboard card) so
// the brand mark stays identical everywhere.
//
// The animation is pure CSS, lightweight, and honors prefers-reduced-motion
// (it freezes to a steady glow). The mark stays crisp at small sizes.
//
// Usage: <VeraFlameIcon size={24} animated />  (animated defaults to true)

import { useId } from "react";

// One <style> injected once per document (keyframes + reduced-motion rules).
const STYLE_ID = "vera-flame-anim-styles";
function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    .vera-flame { display: inline-flex; line-height: 0; }
    .vera-flame svg { display: block; }
    .vera-flame-animated .vera-flame-glow {
      transform-box: fill-box;
      transform-origin: 50% 70%;
      animation: veraFlameFlicker 2.6s ease-in-out infinite;
      filter: drop-shadow(0 0 1.5px rgba(19,194,194,0.55));
      will-change: transform, opacity, filter;
    }
    .vera-flame-animated .vera-flame-core {
      transform-box: fill-box;
      transform-origin: 50% 70%;
      animation: veraFlameCore 1.9s ease-in-out infinite;
    }
    @keyframes veraFlameFlicker {
      0%,100% { transform: scaleY(1) scaleX(1); opacity: 1; filter: drop-shadow(0 0 1.5px rgba(19,194,194,0.5)); }
      35%     { transform: scaleY(1.06) scaleX(0.98); opacity: 0.94; filter: drop-shadow(0 0 3px rgba(82,196,26,0.6)); }
      70%     { transform: scaleY(0.97) scaleX(1.02); opacity: 1; filter: drop-shadow(0 0 2px rgba(22,119,255,0.55)); }
    }
    @keyframes veraFlameCore {
      0%,100% { opacity: 0.85; transform: scaleY(1); }
      50%     { opacity: 1; transform: scaleY(1.08); }
    }
    @media (prefers-reduced-motion: reduce) {
      .vera-flame-animated .vera-flame-glow,
      .vera-flame-animated .vera-flame-core {
        animation: none !important;
        filter: drop-shadow(0 0 2px rgba(19,194,194,0.5));
      }
    }
  `;
  document.head.appendChild(el);
}

export default function VeraFlameIcon({ size = 20, animated = true, className = "", title }) {
  const uid = useId().replace(/[:]/g, "");
  const gid = `veraFlame_${uid}`;
  ensureStyles();
  return (
    <span
      className={`vera-flame${animated ? " vera-flame-animated" : ""}${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" focusable="false">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1677ff" />
            <stop offset="55%" stopColor="#13c2c2" />
            <stop offset="100%" stopColor="#52c41a" />
          </linearGradient>
        </defs>
        {/* Outer flame (glows + flickers) */}
        <path
          className="vera-flame-glow"
          fill={`url(#${gid})`}
          d="M12 2c.6 3.2-1.4 4.9-2.9 6.6C7.7 10.2 6.5 11.7 6.5 14a5.5 5.5 0 0 0 11 0c0-1.8-.7-3.1-1.7-4.4-.3.9-.9 1.6-1.8 2 .6-2.2-.2-4.4-1.5-6.1C11.7 4.4 12 3 12 2Z"
        />
        {/* Inner core (breathes) */}
        <path
          className="vera-flame-core"
          fill="#ffffff"
          fillOpacity="0.9"
          d="M12.2 14.2c1.3 0 2.1.9 2.1 2 0 1.4-1.1 2.2-2.3 2.2-1.3 0-2.3-.8-2.3-2.1 0-.9.5-1.5 1-2 .1.7.6 1.1 1.2 1.1.7 0 1.1-.5 1.1-1.1 0-.05 0-.1 0-.1Z"
        />
      </svg>
    </span>
  );
}
