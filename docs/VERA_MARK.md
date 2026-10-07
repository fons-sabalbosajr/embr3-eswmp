# VERA official mark

The single icon used for VERA, the assistant, on every surface: the portal
launcher, chat header and thinking indicator, admin dashboard card,
notifications, onboarding, the landing-page avatar and the Submissions
**Remarks** column.

It merges the two approved design studies:

- **Animated flame.** The identity itself: a flame drawn as dots in the logo's
  own colours, with a distinct motion for each thing VERA is doing.
- **Border beam.** A light that travels the flame's outline. It is the
  **activity cue**: it runs only while VERA is busy, so a user can tell at a
  glance whether VERA is still working. When idle, the mark stays quiet.

## Where it lives

| File | Role |
|---|---|
| `front-end/src/components/VeraFlameIcon.jsx` | The React component every screen uses |
| `front-end/src/components/vera/veraMarkEngine.js` | Framework-agnostic canvas engine (states, beam, glyph, tile) |
| `front-end/src/components/vera/veraMarkData.js` | Generated geometry: dot grids, flame outline, brand gradient. Do not edit by hand |

## Usage

```jsx
import VeraFlameIcon from "../components/VeraFlameIcon";

<VeraFlameIcon size={24} />                                   // idle
<VeraFlameIcon size={28} state={typing ? "thinking" : "idle"} /> // chat reply in progress
<VeraFlameIcon size={14} state={busy ? "working" : "idle"} animated={busy} />
<VeraFlameIcon size={64} anime theme="dark" title="VERA" />    // hero, once per screen
<VeraFlameIcon size={72} tile theme="dark" />                  // app tile
```

| Prop | Default | Meaning |
|---|---|---|
| `size` | `20` | Square size in px |
| `state` | `"idle"` | `idle`, `thinking`, `working`, `searching`, `listening`, `success` |
| `anime` | `false` | Hero idle: embers and a soft glow. Use once per screen. |
| `animated` | `true` | `false` draws a still mark. Use it in lists, menus and tables. |
| `tile` | `false` | Draws the app-icon tile behind the mark |
| `theme` | `"light"` | The surface it sits on: `"light"` or `"dark"` |
| `title` | — | Accessible name. Without it the mark is decorative (`aria-hidden`). |

## States

| State | Motion | Beam | Use for |
|---|---|---|---|
| `idle` | Gentle flicker | off | Default |
| `thinking` | Flame gathers into a rotating orb | circles the orb | Generating a chat reply, assessing data |
| `working` | Dots orbit on tilted rings | runs the outline | Generating a remark, a bulk operation |
| `searching` | A scan line sweeps across | runs the outline | Looking up records |
| `listening` | A waveform rolls through the dots | off | The user is typing to VERA |
| `success` | Orb catches fire bottom-up, then settles to idle by itself | off | A task just finished |

Turn a busy state off when the work ends. A beam that never stops reads as stuck.

## Size rules

- **28 px and up:** the dotted flame. The engine picks one of three dot
  densities (under 44 px, 44–149 px, 150 px and up).
- **Under 28 px:** dots blur, so the mark becomes a crisp **vector glyph**, the
  flame's exact outline filled with the brand gradient. When busy, the glyph
  steps back and a progress-style **ring** runs around it.

## Surfaces

- **Light** (default): dot and glyph colours are deepened about 20% for contrast.
  The beam has no bloom on light surfaces.
- **Dark** (`theme="dark"`): original colours with additive glow.
- **Tile** (`tile`): a rounded navy (dark) or white (light) tile. When busy,
  the beam rides the tile border.
- Do not place the mark directly on the blue-teal-green brand gradient. Put it
  on a white disc or the navy tile.

## Accessibility and performance

- `prefers-reduced-motion`: still frames only. A busy mark keeps a **fixed**
  beam segment, so the status stays visible without motion.
- A busy mark sets `aria-busy="true"` on its canvas. Pass `title` when the mark
  is the only thing that identifies VERA.
- All mounted marks share **one** `requestAnimationFrame` loop. A mark stops
  drawing when it is off-screen or the tab is hidden, and `animated={false}`
  marks never join the loop.
- Canvas resolution is capped at 2× device pixel ratio.

## Regenerating the geometry

`veraMarkData.js` was extracted from the two design studies (the dot grids and
the outline paths; the embedded logo bitmap is not used). If the studies
change, re-extract `VERA_DOTS` and `VERA_BEAM.paths` into the same shape:
`DOTS`, `OUTLINE`, and `GRADIENT` (three hex stops averaged from the dot colours,
left to right).
