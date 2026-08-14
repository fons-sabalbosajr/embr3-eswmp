// ── Landing page — "systems operating" mockup motion ──
//
// ONE reusable sequence for the hero dashboard mockup, rather than a bespoke
// animation per element (see the motion-language rule in the landing brief).
// It animates the markup that is ALREADY on the page — stat values, chart bars,
// the donut, the recent-submissions rows — so nothing here invents data or new
// DOM. Counters animate up to the exact value already rendered in the JSX and
// restore that string verbatim on completion, so the resting state of the page
// is byte-identical to before.
//
// Built on anime.js v4, the animation system this page already uses. No new
// dependency, no video runtime.
//
// ── Cost control ────────────────────────────────────────────────────────────
//   • Nothing runs until the mockup scrolls into view (IntersectionObserver).
//   • The refresh loop PAUSES when it scrolls out and resumes on return, so an
//     off-screen hero never burns CPU.
//   • Only `transform`, `opacity` and `height` on small elements — no layout
//     thrashing, no rAF loop of our own (anime.js drives one shared ticker).
//   • Reduced motion and small screens get progressively less: see below.
//
// ── Accessibility / responsiveness ──────────────────────────────────────────
//   • prefers-reduced-motion → the module does nothing at all. The mockup still
//     renders its full static content; no information is animation-dependent.
//   • ≤768px → the one-time reveal runs, but the periodic "live refresh" loop
//     does not. Mobile gets the impression without the repeating cost.

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const SMALL_SCREEN_QUERY = "(max-width: 768px)";

// "142" → { value: 142, decimals: 0, prefix: "", suffix: "" }
// "67.3%" → { value: 67.3, decimals: 1, prefix: "", suffix: "%" }
// Returns null for anything non-numeric, which is then left untouched.
export function parseMetric(text) {
  const raw = String(text ?? "").trim();
  const match = raw.match(/^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
  if (!match) return null;
  const numeric = Number(match[2].replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return null;
  const decimals = (match[2].split(".")[1] || "").length;
  return { value: numeric, decimals, prefix: match[1], suffix: match[3], original: raw };
}

export const formatMetric = (n, { decimals, prefix, suffix }) =>
  `${prefix}${decimals > 0 ? n.toFixed(decimals) : Math.round(n).toLocaleString()}${suffix}`;

/**
 * Start the mockup sequence.
 *
 * @param {HTMLElement} root        landing page root
 * @param {object}      anime       { animate, stagger } from animejs
 * @returns {Function}              cleanup — always safe to call
 */
export function startMockupMotion(root, { animate, stagger }) {
  if (!root || typeof window === "undefined") return () => {};
  if (window.matchMedia?.(REDUCED_MOTION_QUERY).matches) return () => {};

  const dashboard = root.querySelector(".lp-hero-mock-dashboard");
  if (!dashboard) return () => {};

  const smallScreen = () => window.matchMedia?.(SMALL_SCREEN_QUERY).matches ?? false;

  const created = [];
  const track = (a) => { if (a) created.push(a); return a; };
  let refreshTimer = null;
  let visible = false;
  let revealed = false;

  const statValues = [...dashboard.querySelectorAll(".lp-hero-mock-stat-value")];
  const bars = [...dashboard.querySelectorAll(".lp-hero-mock-bar-fill")];
  const rows = [...dashboard.querySelectorAll(".lp-hero-mock-table tbody tr")];
  const donutPct = dashboard.querySelector(".lp-hero-mock-donut-pct");

  // Each bar's authored height is its resting truth; the sequence only ever
  // returns to it, so the mockup can never drift away from the designed layout.
  const barTargets = bars.map((bar) => bar.style.height || "0%");

  // ── One-time reveal: the dashboard "boots up" ─────────────────────────────
  const runReveal = () => {
    if (revealed) return;
    revealed = true;

    // Counters climb to the value already in the markup.
    statValues.forEach((el, i) => {
      const metric = parseMetric(el.textContent);
      if (!metric) return;
      const state = { v: 0 };
      track(animate(state, {
        v: metric.value,
        duration: 1400,
        delay: i * 110,
        ease: "out(3)",
        onUpdate: () => { el.textContent = formatMetric(state.v, metric); },
        // Restore the authored string exactly — no rounding drift.
        onComplete: () => { el.textContent = metric.original; },
      }));
    });

    // Bars grow from the baseline, staggered left-to-right.
    if (bars.length) {
      bars.forEach((bar) => { bar.style.height = "0%"; });
      track(animate(bars, {
        height: (_, i) => barTargets[i],
        duration: 900,
        delay: stagger(80, { start: 220 }),
        ease: "out(3)",
      }));
    }

    if (donutPct) {
      const metric = parseMetric(donutPct.textContent);
      if (metric) {
        const state = { v: 0 };
        track(animate(state, {
          v: metric.value,
          duration: 1500,
          delay: 260,
          ease: "out(3)",
          onUpdate: () => { donutPct.textContent = formatMetric(state.v, metric); },
          onComplete: () => { donutPct.textContent = metric.original; },
        }));
      }
    }

    // Recent submissions arrive as records, not as a static block.
    if (rows.length) {
      track(animate(rows, {
        opacity: [0, 1],
        translateY: [8, 0],
        duration: 520,
        delay: stagger(90, { start: 420 }),
        ease: "out(3)",
        // Clear the inline props so the rows return to stylesheet control.
        onComplete: (self) => { self.revert?.(); },
      }));
    }
  };

  // ── Repeating "live refresh" ──────────────────────────────────────────────
  // A couple of bars re-settle every few seconds, the way a dashboard looks when
  // a new figure lands. Deliberately small and infrequent: it should read as a
  // system working, not as decoration competing with the hero copy.
  const runRefresh = () => {
    if (!visible || !bars.length) return;
    const index = Math.floor(Math.random() * bars.length);
    const bar = bars[index];
    const target = parseFloat(barTargets[index]) || 0;
    // ±14% of the authored height, clamped — never a dramatic jump.
    const nudged = Math.max(12, Math.min(96, target + (Math.random() * 28 - 14)));
    track(animate(bar, {
      height: [`${target}%`, `${nudged}%`, `${target}%`],
      duration: 2200,
      ease: "inOutSine",
    }));
  };

  const startRefreshLoop = () => {
    if (refreshTimer || smallScreen()) return; // mobile: reveal only
    refreshTimer = window.setInterval(runRefresh, 3200);
  };
  const stopRefreshLoop = () => {
    if (!refreshTimer) return;
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  };

  // Visibility gate — the whole point of the cost control above.
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        visible = entry.isIntersecting;
        if (visible) {
          runReveal();
          startRefreshLoop();
        } else {
          stopRefreshLoop();
        }
      });
    },
    { threshold: 0.25 },
  );
  io.observe(dashboard);

  // A backgrounded tab should not keep animating either.
  const onVisibilityChange = () => {
    if (document.hidden) stopRefreshLoop();
    else if (visible) startRefreshLoop();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    io.disconnect();
    stopRefreshLoop();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    created.forEach((a) => { try { a.pause?.(); a.revert?.(); } catch { /* ignore */ } });
    // Put the authored heights back, in case cleanup lands mid-refresh.
    bars.forEach((bar, i) => { bar.style.height = barTargets[i]; });
  };
}

export default startMockupMotion;
