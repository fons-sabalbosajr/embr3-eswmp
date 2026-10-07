// VERA official mark — rendering engine (framework-agnostic, 2D canvas).
//
// One mark, merged from the two approved design studies:
//   • the DOTTED FLAME (VERA "animated flame") — the identity itself, drawn as
//     dots in the logo's own colours, with a state per thing VERA is doing;
//   • the BORDER BEAM (VERA "border beam") — a light that travels the flame's
//     outline. It is the ACTIVITY cue: it only runs while VERA is busy, so a
//     glance tells the user whether VERA is working.
//
// Corporate defaults, deliberately calmer than the studies:
//   • idle is quiet — a gentle flicker, no embers; the hero variant adds embers;
//   • the beam appears only for thinking / working / searching;
//   • below GLYPH_MAX px the dots would blur into mush, so the mark becomes a
//     crisp vector glyph (the beam still runs on it);
//   • prefers-reduced-motion renders still frames (a busy mark keeps a static
//     beam so the status is still visible), and nothing animates off-screen or
//     in a background tab;
//   • every mounted mark shares ONE requestAnimationFrame loop.

import { DOTS, OUTLINE, GRADIENT } from "./veraMarkData.js";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => k * k * (3 - 2 * k);
const mix = (a, b, k) => a + (b - a) * k;

// px: below this the crisp vector glyph is drawn instead of dots. Checked on
// screen: dotted marks under ~28px read as faint fuzz on a light surface.
export const GLYPH_MAX = 28;
// Dot / glyph colours were designed for a dark surface; on light they are
// darkened so the mark keeps contrast (brand hue unchanged).
const LIGHT_SHADE = 0.8;
export const VERA_STATES = ["idle", "thinking", "working", "searching", "listening", "success"];
const BUSY = new Set(["thinking", "working", "searching"]);

// Ink on the two surfaces the app uses.
const SURFACE = {
  light: { ink: [14, 42, 48], hairline: "rgba(13,43,49,0.14)", tile: "#FFFFFF", tileEdge: "rgba(13,43,49,0.10)" },
  dark: { ink: [226, 246, 242], hairline: "rgba(221,245,240,0.16)", tile: "#0D2B31", tileEdge: "rgba(221,245,240,0.10)" },
};
// Beam colour stops (h, s, l) — the "vera" palette of the beam study.
const BEAM = [[186, 100, 56], [170, 80, 50], [140, 75, 52], [100, 85, 60]];
const BEAM_PERIOD = 3.1; // s per lap

// ── geometry ─────────────────────────────────────────────────────────────────
function prepPath(pts) {
  const n = pts.length;
  const cum = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return { pts, n, cum, L: cum[n] };
}
function pointAt(P, s) {
  s = ((s % P.L) + P.L) % P.L;
  let lo = 0;
  let hi = P.n;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (P.cum[m] <= s) lo = m;
    else hi = m;
  }
  const a = P.pts[lo];
  const b = P.pts[(lo + 1) % P.n];
  const t = (s - P.cum[lo]) / (P.cum[lo + 1] - P.cum[lo] || 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
const circle = (cx, cy, r, n = 180) =>
  Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * TAU - Math.PI / 2) * r, cy + Math.sin((i / n) * TAU - Math.PI / 2) * r]);
function roundRect(h, r, n = 240) {
  // Perimeter of a rounded square of half-size h, corner radius r.
  const pts = [];
  const straight = 2 * (h - r);
  const quarter = (Math.PI / 2) * r;
  const per = 4 * (straight + quarter);
  const corners = [[h - r, -(h - r)], [h - r, h - r], [-(h - r), h - r], [-(h - r), -(h - r)]];
  const starts = [[-(h - r), -h], [h, -(h - r)], [h - r, h], [-h, h - r]];
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (let k = 0; k < n; k++) {
    let d = (k / n) * per;
    for (let side = 0; side < 4; side++) {
      if (d <= straight) {
        pts.push([starts[side][0] + dirs[side][0] * d, starts[side][1] + dirs[side][1] * d]);
        break;
      }
      d -= straight;
      if (d <= quarter) {
        const a = -Math.PI / 2 + side * (Math.PI / 2) + d / r;
        pts.push([corners[side][0] + Math.cos(a) * r, corners[side][1] + Math.sin(a) * r]);
        break;
      }
      d -= quarter;
    }
  }
  return pts;
}
const FLAME_PATHS = OUTLINE.map((p) => ({ hole: p.hole, ...prepPath(p.p) }));
const ORB_PATH = [{ hole: false, ...prepPath(circle(0, 0.12, 0.74)) }];
// Small busy marks: a ring around the (shrunk) glyph — at glyph sizes a beam on
// the flame's own outline is lost against the same-hue fill.
const RING_PATH = [{ hole: false, ...prepPath(circle(0, 0, 1.02)) }];
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v * k).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
};
const TILE_PATH = [{ hole: false, ...prepPath(roundRect(1.18, 0.36)) }];

function tracePaths(ctx, paths) {
  ctx.beginPath();
  for (const P of paths) {
    ctx.moveTo(P.pts[0][0], P.pts[0][1]);
    for (let i = 1; i < P.n; i++) ctx.lineTo(P.pts[i][0], P.pts[i][1]);
    ctx.closePath();
  }
}

// ── dot grids ────────────────────────────────────────────────────────────────
const GRIDS = {};
function grid(key) {
  if (GRIDS[key]) return GRIDS[key];
  const g = DOTS[key];
  const n = g.p.length;
  GRIDS[key] = {
    s: g.s,
    dots: g.p.map((d, i) => {
      const seed = ((i * 2654435761) >>> 0) / 4294967296;
      const seed2 = ((i * 40503 + 17) % 997) / 997;
      const fy = 1 - ((i + 0.5) / n) * 2;
      const fr = Math.sqrt(1 - fy * fy);
      const fa = i * 2.399963;
      return {
        x: d[0], y: d[1], edge: d[3], seed, seed2,
        z: (seed2 - 0.5) * 0.12,
        r: (d[2] >> 16) & 255, g: (d[2] >> 8) & 255, b: d[2] & 255,
        sx: Math.cos(fa) * fr, sy: fy, sz: Math.sin(fa) * fr,
        h: clamp((1 - d[1]) / 2, 0, 1),
        hd: Math.hypot(d[0] - DOTS.hole[0], d[1] - DOTS.hole[1]),
      };
    }),
  };
  return GRIDS[key];
}

// ── dot states: (dot, t, out) → [x, y, z, sizeMul, alphaMul] ─────────────────
function flame(p, t, o, embers) {
  const h = p.h;
  const calm = p.edge ? 0.45 : 1;
  const lick = 0.5 + 0.5 * Math.sin(t * 3.4 - p.y * 7 + p.seed * 2.5);
  const sway = Math.sin(t * 2.2 + p.y * 5 + p.x * 2) * 0.008 * (0.2 + h) * h;
  let x = p.x + sway + Math.sin(t * 2.2 + p.y * 5 + p.seed * 6) * 0.005 * (0.25 + h) * calm;
  let y = p.y - lick * 0.016 * h * h * calm;
  let s = p.edge ? 0.95 + 0.07 * Math.sin(t * 3.4 - p.y * 8) : 0.8 + 0.26 * (0.5 + 0.5 * Math.sin(t * 4 - p.y * 9 + p.seed * 4));
  let a = 1;
  if (embers && p.edge && h > 0.5 && p.seed > 0.8) {
    const ph = (t * 0.55 + p.seed * 7.3) % 1;
    if (ph > 0.55) {
      const e = (ph - 0.55) / 0.45;
      y -= e * 0.32;
      x += Math.sin(e * 5 + p.seed * 9) * 0.04 * e;
      s *= 1 - e * 0.8;
      a = 1 - e;
    }
  }
  o[0] = x; o[1] = y; o[2] = p.z; o[3] = s; o[4] = a;
  return o;
}
function sphere(p, t, o, R = 0.66) {
  const ry = t * 0.7;
  const rx = 0.38;
  let x = p.sx * R;
  let y = p.sy * R;
  let z = p.sz * R;
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  const depth = (z / R + 1) / 2;
  o[0] = x; o[1] = y + 0.12; o[2] = z; o[3] = 0.55 + depth * 0.6; o[4] = 0.25 + depth * 0.75;
  return o;
}
const SCRATCH_A = [];
const SCRATCH_B = [];
const STATES = {
  idle: (p, t, o) => flame(p, t, o, false),
  hero: (p, t, o) => flame(p, t, o, true),
  thinking: (p, t, o) => {
    sphere(p, t, o);
    o[3] *= 0.85 + 0.35 * Math.max(0, Math.sin(p.sy * 6 - t * 3));
    return o;
  },
  working: (p, t, o) => {
    if (p.seed < 0.16 && !p.edge) {
      const ring = Math.floor(p.seed / 0.0534);
      const ang = t * (1.1 + ring * 0.35) * (ring % 2 ? -1 : 1) + p.seed2 * TAU;
      const R = 0.78 + ring * 0.07;
      let x = Math.cos(ang) * R;
      let y = 0;
      let z = Math.sin(ang) * R;
      const tx = [1.15, 0.5, -0.9][ring];
      const tz = [0.35, -0.6, 0.2][ring];
      [y, z] = [y * Math.cos(tx) - z * Math.sin(tx), y * Math.sin(tx) + z * Math.cos(tx)];
      [x, y] = [x * Math.cos(tz) - y * Math.sin(tz), x * Math.sin(tz) + y * Math.cos(tz)];
      const d = (z / R + 1) / 2;
      o[0] = x; o[1] = y + 0.08; o[2] = z; o[3] = 0.5 + d * 0.8; o[4] = 0.3 + d * 0.7;
      return o;
    }
    const a = t * 2.4 * (0.6 + p.seed2) + p.seed * TAU;
    o[0] = p.x + Math.cos(a) * 0.018; o[1] = p.y + Math.sin(a) * 0.009; o[2] = p.z + Math.sin(a) * 0.018;
    o[3] = 0.8 + 0.25 * Math.sin(a); o[4] = 0.9;
    return o;
  },
  searching: (p, t, o) => {
    const band = Math.sin(t * 1.5) * 0.85;
    const k = Math.exp(-Math.pow((p.x - band) / 0.075, 2));
    const ry = Math.sin(t * 0.75) * 0.55;
    const z = p.z + k * 0.14;
    o[0] = p.x * Math.cos(ry) + z * Math.sin(ry); o[1] = p.y; o[2] = -p.x * Math.sin(ry) + z * Math.cos(ry);
    o[3] = (p.edge ? 0.8 : 0.62) + k; o[4] = (p.edge ? 0.6 : 0.36) + k * 0.6;
    return o;
  },
  listening: (p, t, o) => {
    const env = 0.55 + 0.45 * Math.sin(t * 1.4);
    const w = Math.sin(p.x * 8 - t * 5.5);
    o[0] = p.x; o[1] = p.y + w * 0.045 * env * (0.4 + p.h); o[2] = p.z;
    o[3] = 0.75 + 0.45 * (0.5 + 0.5 * w) * env; o[4] = 0.55 + 0.45 * (0.5 + 0.5 * w);
    return o;
  },
  // Orb catches fire from the bottom up and settles into the flame — used once,
  // as the "done" moment, then the mark returns to idle.
  success: (p, t, o) => {
    const m0 = clamp(t / 1.4, 0, 1);
    const delay = (1 - p.h) * 0.45;
    const m = ease(clamp((m0 - delay) / (1 - delay), 0, 1));
    sphere(p, t, SCRATCH_A);
    flame(p, t, SCRATCH_B, false);
    for (let i = 0; i < 5; i++) o[i] = mix(SCRATCH_A[i], SCRATCH_B[i], m);
    return o;
  },
};
const SUCCESS_DURATION = 2.2; // s, then idle

// ── beam ─────────────────────────────────────────────────────────────────────
function hsl(c, dl, a) {
  return `hsla(${c[0]},${c[1]}%,${clamp(c[2] + dl, 0, 100)}%,${a})`;
}
function beamColor(f) {
  const x = clamp(f, 0, 0.9999) * (BEAM.length - 1);
  const i = Math.floor(x);
  const t = x - i;
  const a = BEAM[i];
  const b = BEAM[Math.min(i + 1, BEAM.length - 1)];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function band(ctx, P, s0, s1, width, fa, fc, blur, dl, dpr) {
  const slices = 20;
  const step = (s1 - s0) / slices;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let b = 0; b < slices; b++) {
    const f = (b + 0.5) / slices;
    const a = fa(f);
    if (a <= 0.004) continue;
    const c = beamColor(fc(f));
    ctx.strokeStyle = hsl(c, dl, a);
    if (blur) {
      ctx.shadowBlur = blur * dpr;
      ctx.shadowColor = hsl(c, dl, Math.min(1, a * 1.2));
    }
    ctx.beginPath();
    for (let k = 0; k <= 3; k++) {
      const pt = pointAt(P, s0 + b * step + (step * k) / 3);
      if (k) ctx.lineTo(pt[0], pt[1]);
      else ctx.moveTo(pt[0], pt[1]);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}
// A beam lap along each path; the cut-out runs the other way, half a lap behind.
function drawBeam(ctx, paths, t, level, px, dark, dpr, small) {
  const dl = dark ? 0 : -14;
  ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
  paths.forEach((P) => {
    const dir = P.hole ? -1 : 1;
    const g = P.hole ? 0.75 : 1;
    const head = dir * ((t / BEAM_PERIOD) % 1) * P.L + (P.hole ? P.L * 0.5 : 0);
    const tail = P.L * (P.hole ? 0.45 : 0.38);
    const s0 = dir > 0 ? head - tail : head;
    const s1 = dir > 0 ? head : head + tail;
    const fa = (f) => Math.pow(dir > 0 ? f : 1 - f, 1.7) * level * g;
    const fc = (f) => (dir > 0 ? 1 - f : f);
    // Bloom only on a dark surface — on light it renders as a grey smudge.
    if (!small && dark) band(ctx, P, s0, s1, 9 * px, (f) => fa(f) * 0.2, fc, 18, dl, dpr);
    band(ctx, P, s0, s1, (small ? 2.2 : 3.6) * px, (f) => fa(f) * 0.45, fc, small || !dark ? 2 : 7, dl, dpr);
    band(ctx, P, s0, s1, (small ? 1.3 : 2) * px, fa, fc, 0, dl + (dark ? 14 : 0), dpr);
    const hp = pointAt(P, head);
    ctx.fillStyle = dark ? `rgba(255,255,255,${0.9 * level * g})` : hsl(beamColor(0), dl - 10, 0.9 * level * g);
    ctx.beginPath();
    ctx.arc(hp[0], hp[1], (small ? 1.2 : 1.8) * px, 0, TAU);
    ctx.fill();
  });
  ctx.globalCompositeOperation = "source-over";
}

// ── shared ticker ────────────────────────────────────────────────────────────
const instances = new Set();
let raf = 0;
let lastNow = 0;
function tick(now) {
  raf = 0;
  const dt = Math.min(0.05, lastNow ? (now - lastNow) / 1000 : 0);
  lastNow = now;
  let any = false;
  const pageVisible = typeof document === "undefined" || document.visibilityState !== "hidden";
  instances.forEach((inst) => {
    if (inst.live() && pageVisible) {
      inst.advance(dt);
      inst.draw();
      any = true;
    }
  });
  if (any) raf = requestAnimationFrame(tick);
  else lastNow = 0;
}
function wake() {
  if (!raf && typeof requestAnimationFrame !== "undefined") raf = requestAnimationFrame(tick);
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", wake);

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Mount the mark on a <canvas>. Options:
 *   size      CSS px (square)                         default 24
 *   state     one of VERA_STATES                      default "idle"
 *   hero      richer idle (embers, glow)              default false
 *   tile      app-icon tile around the mark           default false
 *   theme     "light" | "dark"                        default "light"
 *   animated  false → a single still frame            default true
 *   label     accessible name                         default "VERA"
 */
export function mountVeraMark(canvas, options = {}) {
  const opt = { size: 24, state: "idle", hero: false, tile: false, theme: "light", animated: true, label: "VERA", ...options };
  const ctx = canvas.getContext("2d");
  let t = 0;
  let stateT = 0; // time in the current state
  let prev = opt.state;
  let since = -10;
  let beamLevel = BUSY.has(opt.state) ? 1 : 0;
  let visible = true;
  let destroyed = false;
  const reduce = prefersReducedMotion();
  const outA = [];
  const outB = [];

  const io = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        if (visible) wake();
      })
    : null;
  io?.observe(canvas);

  const animates = () => opt.animated && !reduce;
  function setupCanvas() {
    const dpr = Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2);
    canvas.width = Math.round(opt.size * dpr);
    canvas.height = Math.round(opt.size * dpr);
    canvas.style.width = `${opt.size}px`;
    canvas.style.height = `${opt.size}px`;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", opt.label);
    if (BUSY.has(opt.state)) canvas.setAttribute("aria-busy", "true");
    else canvas.removeAttribute("aria-busy");
    return dpr;
  }
  let dpr = setupCanvas();

  function draw() {
    const W = opt.size;
    const dark = opt.theme === "dark";
    const surface = SURFACE[dark ? "dark" : "light"];
    const small = W < GLYPH_MAX;
    // The tile leaves room for its own border; the bare mark leaves room for the beam's bloom.
    const k = W * (opt.tile ? 0.3 : small ? 0.44 : 0.4);
    const px = 1 / k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, (dpr * W) / 2, (dpr * W) / 2 + dpr * W * (opt.tile ? 0 : 0.01));

    if (opt.tile) {
      tracePaths(ctx, TILE_PATH);
      ctx.fillStyle = surface.tile;
      ctx.fill();
      ctx.lineWidth = px;
      ctx.strokeStyle = surface.tileEdge;
      ctx.stroke();
    }

    const orb =!small && (opt.state === "thinking" || (opt.state === "success" && stateT < 0.5));

    if (small) {
      // Crisp vector glyph in the brand gradient. While busy it steps back
      // (scaled down) to make room for the activity ring around it.
      const glyphScale = 0.62 + 0.38 * (1 - beamLevel);
      ctx.save();
      ctx.scale(glyphScale, glyphScale);
      tracePaths(ctx, FLAME_PATHS);
      const grad = ctx.createLinearGradient(-0.75, -0.6, 0.75, 0.9);
      const tone = (hex) => (dark ? hex : shade(hex, LIGHT_SHADE));
      grad.addColorStop(0, tone(GRADIENT[0]));
      grad.addColorStop(0.5, tone(GRADIENT[1]));
      grad.addColorStop(1, tone(GRADIENT[2]));
      ctx.fillStyle = grad;
      ctx.fill("evenodd");
      ctx.restore();
    } else {
      if (opt.hero && dark) {
        const rg = ctx.createRadialGradient(0, 0.2, 0, 0, 0.2, 1.05);
        rg.addColorStop(0, "rgba(20,210,190,0.16)");
        rg.addColorStop(1, "rgba(20,210,190,0)");
        ctx.fillStyle = rg;
        ctx.fillRect(-1.6, -1.6, 3.2, 3.2);
      }
      const g = grid(W >= 150 ? "lg" : W >= 44 ? "md" : "sm");
      const key = (s) => (s === "idle" && opt.hero ? "hero" : s);
      const fnA = STATES[key(prev)] || STATES.idle;
      const fnB = STATES[key(opt.state)] || STATES.idle;
      const tr = clamp((t - since) / 0.9, 0, 1.6);
      const base = g.s * 0.36;
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      const tB = opt.state === "success" ? stateT : t;
      for (let i = 0; i < g.dots.length; i++) {
        const p = g.dots[i];
        const kk = ease(clamp(tr - p.seed * 0.6, 0, 1));
        let o;
        if (kk >= 1 || prev === opt.state) o = fnB(p, tB, outB);
        else {
          fnA(p, t, outA);
          fnB(p, tB, outB);
          o = outA;
          for (let j = 0; j < 5; j++) o[j] = mix(outA[j], outB[j], kk);
        }
        const f = 3.2 / (3.2 - o[2]);
        const al = clamp(o[4], 0, 1);
        if (al <= 0.01) continue;
        ctx.fillStyle = dark
          ? `rgba(${p.r},${p.g},${p.b},${al * 0.92})`
          : `rgba(${Math.round(p.r * LIGHT_SHADE)},${Math.round(p.g * LIGHT_SHADE)},${Math.round(p.b * LIGHT_SHADE)},${al})`;
        ctx.beginPath();
        ctx.arc(o[0] * f, o[1] * f, Math.max(0.35 * px, base * o[3] * f), 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // Activity beam: tile border when tiled, else the orb or the flame outline.
    if (beamLevel > 0.003) {
      const paths = opt.tile ? TILE_PATH : small ? RING_PATH : orb ? ORB_PATH : FLAME_PATHS;
      if (small && !opt.tile) {
        // Faint full track under the ring, so the moving arc reads as progress.
        tracePaths(ctx, RING_PATH);
        ctx.lineWidth = 1.2 * px;
        ctx.strokeStyle = dark ? `rgba(221,245,240,${0.14 * beamLevel})` : `rgba(13,43,49,${0.12 * beamLevel})`;
        ctx.stroke();
      }
      // Reduced motion: a fixed beam segment still says "busy" without moving.
      drawBeam(ctx, paths, animates() ? t : BEAM_PERIOD * 0.3, beamLevel, px, dark, dpr, small);
    }
  }

  const inst = {
    live: () => !destroyed && visible && animates(),
    advance(dt) {
      t += dt;
      stateT += dt;
      const target = BUSY.has(opt.state) ? 1 : 0;
      beamLevel += (target - beamLevel) * Math.min(1, dt * 5);
      if (opt.state === "success" && stateT > SUCCESS_DURATION) api.setState("idle");
    },
    draw,
  };
  instances.add(inst);

  const api = {
    setState(next) {
      if (!VERA_STATES.includes(next) || next === opt.state) return;
      prev = opt.state;
      opt.state = next;
      since = t;
      stateT = 0;
      if (!animates()) beamLevel = BUSY.has(next) ? 1 : 0;
      setupCanvas();
      draw();
      wake();
    },
    update(next = {}) {
      const resized = next.size !== undefined && next.size !== opt.size;
      const { state, ...rest } = next;
      Object.assign(opt, rest);
      if (resized) dpr = setupCanvas();
      if (state !== undefined) api.setState(state);
      draw();
      wake();
    },
    destroy() {
      destroyed = true;
      instances.delete(inst);
      io?.disconnect();
    },
  };
  draw();
  wake();
  return api;
}
