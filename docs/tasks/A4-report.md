# A4 — hover cursor cue — Report

Status: **DONE**. Hovering a villager or structure on the canvas now shows `cursor: pointer`.
Throttled to at most one raycast every ~80 ms AND ≥2 px of movement, skipped entirely while a
button is held, reset on `pointerleave`. Read-only: selection, picking and OrbitControls are
untouched. Changes left uncommitted.

## Files

| File | Lines | Change |
|---|---|---|
| `src/render/index.ts` | 191 (+12) | **A4** `pickHover(clientX, clientY): boolean` on `RenderHandle` — one NDC computation, one raycast, villager first then structure (same precedence as the click chain) |
| `src/main.ts` | 132 (+25) | **A4** throttled `pointermove` listener (`{ passive: true }`) + `pointerleave` cursor reset |

No other files touched. No commit, no new deps, no `any`, no sim changes.

## Implementation

**`RenderHandle.pickHover`** (`src/render/index.ts`) reuses the existing layer pick functions —
the same `raycaster`/`ndc` scratch objects as `pickVillager`/`pickStructure`, so the only
allocation on the hover path is the raycast itself (one `getBoundingClientRect` + one
`intersectObjects` per raycast, identical to a click). A villager hit short-circuits before the
structure raycast, matching the B7 click order in `main.ts`:

```ts
pickHover(clientX: number, clientY: number): boolean {
  if (!villagers && !structures) return false;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  // Same precedence as the click chain in main.ts: a villager wins over a structure.
  return villagers?.pick(raycaster) != null || structures?.pick(raycaster) != null;
}
```

**Event wiring** (`src/main.ts`) sits next to the existing click chain and shares none of its
state — the drag detection (`downX/downY/dragging`) is untouched:

```ts
const HOVER_THROTTLE_MS = 80;
const HOVER_MIN_MOVE_PX = 2;
let hoverLastT = 0;
let hoverLastX = 0;
let hoverLastY = 0;

canvas.addEventListener('pointermove', (ev) => {
  if (ev.buttons !== 0) return; // orbiting/dragging — leave the cursor alone
  const now = performance.now();
  if (now - hoverLastT < HOVER_THROTTLE_MS) return;
  if (Math.hypot(ev.clientX - hoverLastX, ev.clientY - hoverLastY) < HOVER_MIN_MOVE_PX) return;
  hoverLastT = now;
  hoverLastX = ev.clientX;
  hoverLastY = ev.clientY;
  canvas.style.cursor = render.pickHover(ev.clientX, ev.clientY) ? 'pointer' : '';
}, { passive: true });

canvas.addEventListener('pointerleave', () => {
  canvas.style.cursor = '';
});
```

### Why this shape

- **Both gates must pass** (≥80 ms since the last raycast AND ≥2 px of movement since the last
  event) — a fast small jitter raycasts at most every 80 ms, and a slow pointer sweeping across
  the village raycasts on every 2 px step. Worst case ~12.5 raycasts/s, each one
  `intersectObjects` against the villager/structure groups only (never the forest).
- **`ev.buttons !== 0` first** — while orbiting/dragging the cursor is left exactly as it was,
  per the brief. The first move after release re-evaluates normally (the stored position is
  from before the drag, so the 2 px gate passes and the cursor corrects itself).
- **No per-event allocations** — the handler writes only three module-level numbers and a
  cursor string; the raycast reuses the handle's scratch `raycaster`/`ndc`. No closures, no
  vectors, no arrays created per event.
- **Read-only** — `pickHover` calls the same `villagers.pick`/`structures.pick` the click chain
  uses; it cannot change selection, and it never touches `controls`. The existing
  `pointermove` drag-detector listener is a separate listener and behaves identically.

## Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` | exit 0 (pre-existing chunk-size warning for the three.js bundle, unrelated) |
| `pnpm test` | exit 0 — 6 files, **62/62** tests passed |

## Deviations

None. The brief's numbers (80 ms, 2 px, `e.buttons !== 0`, `pointerleave` reset, villager-first
order, `{ passive: true }`) are implemented as specified.

## Known gaps / concerns for the orchestrator

1. **DESIGN.md §3 `RenderHandle` contract listing does not yet mention `pickHover`.** DESIGN.md
   was outside this task's file allow-list, so the contract block still shows only the T5/B5
   methods. A doc-owner pass should add one line (`/** A4: hover cue … */ pickHover…`) to keep
   the binding spec in sync.
2. **Cursor can lag one gesture behind after an orbit drag.** If the user drags the camera and
   releases without moving the pointer, the cursor keeps its pre-drag value until the next
   qualifying `pointermove`. The brief specifies reset only on `pointerleave`, so this is
   intentional — flagging it so the behaviour is a known decision, not an oversight.
3. **No live-browser validation.** Per the brief, the orchestrator owns the browser
   (`pnpm dev` + chrome-devtools); this task was verified by tsc/build/test only. The cue is a
   pure addition of two listeners plus a read-only handle method, so the blast radius is small,
   but the orchestrator's live check should confirm the cursor flips over a villager and over a
   ghost/built structure.
