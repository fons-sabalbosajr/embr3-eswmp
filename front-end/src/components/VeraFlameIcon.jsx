// VERA official mark (React).
//
// The single VERA icon used on every surface — launcher, chat header, thinking
// indicator, dashboard card, notifications, onboarding, landing avatar. It
// renders the merged official design (dotted flame + activity beam); see
// components/vera/veraMarkEngine.js for the design rules.
//
// Usage:
//   <VeraFlameIcon size={24} />                      // idle mark
//   <VeraFlameIcon size={16} state="thinking" />     // busy: beam runs the outline
//   <VeraFlameIcon size={56} anime />                // hero idle (embers, glow)
//   <VeraFlameIcon size={64} tile theme="dark" />    // app-icon tile
//
// Props
//   size      px, square                                    (20)
//   state     idle | thinking | working | searching | listening | success
//   anime     hero treatment for large, prominent placements (false)
//   animated  false → a still mark (lists, menus)            (true)
//   tile      draw the app-icon tile behind the mark          (false)
//   theme     "light" | "dark" — the surface it sits on      ("light")
//   title     accessible name; omitted → decorative (aria-hidden)

import { useEffect, useRef } from "react";
import { mountVeraMark, VERA_STATES } from "./vera/veraMarkEngine";

export default function VeraFlameIcon({
  size = 20,
  state = "idle",
  anime = false,
  animated = true,
  tile = false,
  theme = "light",
  className = "",
  title,
}) {
  const canvasRef = useRef(null);
  const markRef = useRef(null);
  const safeState = VERA_STATES.includes(state) ? state : "idle";

  // Mount once per canvas; later prop changes are pushed into the live mark so
  // a state change morphs (idle → thinking) instead of restarting.
  useEffect(() => {
    if (!canvasRef.current) return undefined;
    markRef.current = mountVeraMark(canvasRef.current, {
      size, state: safeState, hero: anime, animated, tile, theme, label: title || "VERA",
    });
    return () => {
      markRef.current?.destroy();
      markRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    markRef.current?.update({ size, state: safeState, hero: anime, animated, tile, theme, label: title || "VERA" });
  }, [size, safeState, anime, animated, tile, theme, title]);

  return (
    <span
      className={`vera-flame${className ? ` ${className}` : ""}`}
      style={{ display: "inline-flex", lineHeight: 0, width: size, height: size }}
      aria-hidden={title ? undefined : true}
    >
      <canvas ref={canvasRef} width={size} height={size} style={{ width: size, height: size, display: "block" }} />
    </span>
  );
}
