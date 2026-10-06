# Day/Night Cycle — Design (batch 8)

Status: **approved in chat 2026-10-06** (three feel decisions + both design sections); awaiting
written-spec review. No implementation until the spec is reviewed and the implementation plan is
approved (HARD GATE).
Authority: `DESIGN.md` §2 (feel), §3 (contracts), §3.2 (binding numbers), §6 (UI zones).
Execution: ships after batch 7 (traders, merged); this spec pins schema **v5** on that assumption.
If execution order ever flips, bump by one from whatever version is current and extend the same
chain.

## Goal

The village lives a day. Light and sky ease from morning through a golden dusk into a deep,
readable blue-hour night and back to dawn — all on an 8-minute cycle that saves and resumes
exactly. After dark the village gently settles: idle villagers drift to warm spots around the fire
while evening rests stretch, the campfire reads warmer, the lantern lights itself, hut windows
warm on, and the drifting motes become fireflies. No penalties, no failure states, no new UI —
the sky is the clock.

## Non-goals

- No seasons, weather, or moon phases.
- No sleep / tuck-into-huts mechanic (villagers with huts still live their normal day).
- No coupling with the trader's schedule (a visit may fall at dusk; nothing special happens).
- No new UI (no clock, no badge); no new audio; no new structure kinds.
- No new dependencies; renderer stays flat-shaded low-poly in the existing palette family.

## Player experience

1. A fresh village starts **mid-morning** (`dayT 0.25`); the trader's first visit arrives about
   four minutes later, just before dusk.
2. Light eases through the day; around **4 minutes in**, the sky turns golden, then blue — dusk
   arrives just after the trader's first call.
3. Through dusk and night, idle villagers stroll to warm spots around the fire and stay put until
   you give them something to do; rests begun in the evening last ~1.5× as long. The fire glows
   warm, the lantern lights, hut windows warm on, and fireflies drift where butterflies were.
4. Dawn returns gently. Reload at any moment — including mid-evening — and the exact time of day
   resumes.

## Part 1 — Sim model

### 1.1 State (DESIGN §3)

```ts
export interface Clock {
  dayMs: number; // time since midnight; advances with tick(), wraps at DAY_MS
}
export interface GameState { /* … */ clock: Clock; }
```

`state.clock.dayMs` advances in `tick(state, dtMs)` inside the existing `dtMs > 0` region, before
the villager loop: `dayMs = (dayMs + dtMs) % DAY_MS`. Deterministic, no wall-clock. A giant `dt`
wraps once via the single modulo and can never skip a boundary (nothing is boundary-triggered).

### 1.2 Constants & derivations (binding)

| Constant / function | Value / rule | Meaning |
|---|---|---|
| `DAY_MS` | `480_000` | one full cycle (8 min) |
| `FRESH_START_T` | `0.25` | fresh game starts mid-morning |
| phase map (`dayT = dayMs / DAY_MS`) | `0.00–0.09` night · `0.09–0.22` dawn · `0.22–0.78` day · `0.78–0.91` dusk · `0.91–1.00` night | ~0.75 min deep night, ~1 min dawn, ~4.5 min day, ~1 min dusk, ~0.75 min night |
| `dayT(state)` | pure; `dayMs / DAY_MS` | 0..1 clock position |
| `dayPhase(state)` | pure; `'night' | 'dawn' | 'day' | 'dusk'` by the map above | phase name (rhythm + ambience switching) |
| `dayFactor(state)` | pure; `0` deep night … `1` full day | smoothstep ramp up through dawn (`0.09–0.22`), `1` through day, ramp down through dusk (`0.78–0.91`), `0` through night |
| `EVENING_REST_SCALE` | `1.5` | rest committed at dusk/night lasts ×1.5 |
| `WARMING_RADIUS` | `2.4` | gathering ring radius near the fire (±0.2 hash jitter) |

Public surface additions: `DAY_MS`, `dayT(state)`, `dayPhase(state)`, `dayFactor(state)`. Nothing
else. The sim itself uses only `dayPhase` (for the rhythm below).

### 1.3 Evening rhythm (gentle; no failure)

There is deliberately no autonomous task-chooser in this sim — villagers wait for assignments. So
the evening rhythm has exactly two rules, both of which leave assignment authority untouched:

**a. Gathering drift (idle only).** While `dayPhase` is `'dusk'` or `'night'`, whenever a villager
is `'idle'` with no task and not already near their warm spot, they stroll (at roughly half
walking pace) to it and idle there. A villager's warm spot is deterministic: angle =
`(index + 0.5) × golden angle` (2.399963 rad), radius `WARMING_RADIUS` jittered ±0.2 by the
existing `hash01`; every villager gets a unique seat, so seats never overlap. Consequences:

- The evening naturally gathers everyone by the fire with no timers at all: finish a task after
  dusk and you drift back to the warmth until the next assignment.
- `assignTask` always wins instantly — drift is only ever a default for the truly idle, and a
  walking drifter retargets through the normal assignment path. By day the drift never fires.
  Newly arrived newcomers join the fire once they settle (they are idle at their hut).
- Nothing blocks, delays, refuses, or punishes anything; no new villager state is required
  (a drifting villager is `'walking'`; a warmed one is `'idle'` at their seat).

**b. Evening rests stretch.** A rest **committed** while `dayPhase` is `'dusk'` or `'night'` gets
`restMs × EVENING_REST_SCALE` (fire-rest 4000 → 6000; meal-rest 5500 → 8250). Rests committed by
day are byte-identical to today; work, cook, walk, and fed timers are untouched. Feeding, favors,
arrivals, and the trader are unaffected.

## Part 2 — Persist (schema v5, after traders' v4)

- `VERSION = 5`. Migration **v4 → v5**: `clock = { dayMs: DAY_MS * FRESH_START_T }` (an ancient
  save wakes on a fresh morning). Loader chain becomes **v1 → v2 → v3 → v4 → v5**, with the
  post-migration `isPlausibleState` re-validation on every branch (the batch-6 rule).
- v5 validation adds: `clock.dayMs` finite, `0 ≤ dayMs < DAY_MS`.
- Round-trip: a save mid-evening restores `dayMs` exactly; a reload resumes light, rhythm and
  ambience at the same point of the day.

## Part 3 — Render: light pipeline

- **`src/render/daylight.ts` (new, pure, canvas-free):**
  `daylightFor(dayFactor: number)` returns the frame's lighting strip — background/sky, fog,
  hemisphere sky/ground colors, hemisphere intensity, sun color, sun intensity, plus a `night`
  scalar (`1 − dayFactor`) for glows. Keyframe blend between the existing day strip and a twilight
  strip; all values inside the current palette family (no pure black, no pure white, muted; warm
  accents preserved). Unit-testable without WebGL (the `trader.test.ts` precedent).
- **Wiring** (`src/render/index.ts` + `src/render/environment.ts`): every frame, hemisphere light,
  directional sun (color + intensity; position and shadows unchanged), fog, and sky/background are
  written from `daylightFor(dayFactor(state))`. The fire visuals take the `night` scalar: the
  campfire reads warmer and its embers rounder after dark. Fuel/cook rules are untouched.

## Part 4 — Render: glows & ambience

- **Lantern** (`src/render/structures.ts`): the lamp globe — already reserved "unlit so it still
  glows at dusk" — gets an emissive ramp driven by `night`; off through the day, warm through dusk
  and night.
- **Hut windows** (`src/render/structures.ts`): each hut gains a small emissive window quad on its
  front face (one shared material, ~2 tris per hut); warms on through dusk with the lantern,
  off by day. One flag to cut if live review dislikes it.
- **Ambient species swap** (`src/render/ambient.ts`): through dusk, birds and butterflies fade
  out (deterministic, by `dayPhase`/`night`) and return at dawn; the motes become **fireflies** —
  warmer color, slower drift, a gentle blink, slightly denser near the fire — and revert at dawn.
  Species count stays exactly three (pillar 3).
- No per-frame allocations beyond what the existing layers already do; all effects are pure
  functions of `state` + `timeSec`.

## Part 5 — UI

**None.** No new zones, pills, lines, or hints (§6 untouched — the sky is the clock). The popover,
hint priority, and list behavior are identical.

## Part 6 — Tests

- **Sim**: `dayMs` advances by `dt`; wraps once at `DAY_MS` (incl. a giant-dt tick — no drift, no
  NaN, stays in `[0, DAY_MS)`); `dayT`/`dayPhase` boundaries at exactly 0.09/0.22/0.78/0.91;
  `dayFactor` endpoints and monotonic ramps. Gathering drift: an idle villager at dusk walks to
  their deterministic warm spot and idles there; seats never overlap (distinct angles); an
  assignment mid-drift retargets instantly; by day no drift ever fires; the drift is deterministic
  across identical runs. Evening rests: rests committed at dusk/night run ×1.5 (both rest kinds);
  an identical day-committed rest is unchanged; work/cook/fed timers are untouched.
- **Persist**: v4 → v5 default (fresh morning); v1 → v5 chain keeps the village end-to-end; v5
  round-trip mid-evening; invalid `clock` (missing / NaN / negative / ≥ `DAY_MS`) → null.
- **Render**: `daylightFor` — endpoints match the shipped day palette at `dayFactor 1`; twilight
  output respects the guardrails (no pure black/white; muted); monotonic interpolation; `night`
  scalar = `1 − dayFactor`.

**Review Focus pins** (each lands in a task's tests): (1) reload mid-evening resumes the exact
`dayMs` (persist); (2) giant-dt wrap keeps the clock exact (sim); (3) the evening rhythm is
deterministic and never fights the player — gathering fires only for idle, taskless villagers, any
assignment interrupts instantly, and day behavior plus every non-rest timer is byte-identical
(sim); (4) `daylightFor` guardrails (render); (5) the v1 → v5 migration chain stays intact
end-to-end (persist).

## Part 7 — Execution plan (after spec approval + plan)

One parallel, file-disjoint wave on **free models** (fallbacks on rate limits), dispatched after
batch 7 (merged — schema v5 builds on v4):

| Task | Files | Scope |
|---|---|---|
| N1 sim | `src/sim/**` | `Clock`, `DAY_MS`, `dayT`/`dayPhase`/`dayFactor`, gathering drift, evening rest stretch, tests |
| N2 persist | `src/persist/**` | v5 + chained migrations + validation + tests |
| N3 render-light | `src/render/daylight.ts` (new), `src/render/index.ts`, `src/render/environment.ts`, `daylight.test.ts` (new) | pure lighting strip, wiring, fire night scalar, tests |
| N4 render-ambience | `src/render/structures.ts`, `src/render/ambient.ts` | lantern glow, hut windows, species swap/motes→fireflies |

Then: freeze → live pass (pin `dayMs` to dawn/day/dusk/night for screenshots; reload mid-evening;
lantern + windows + fireflies at night; birds/butterflies gone after dark; rest-bias counts day vs
night) → commits → independent review (mimo) → fix round.

## Part 8 — DESIGN.md amendments (applied by the orchestrator with this spec)

1. §3: `Clock` shape; public surface additions — `DAY_MS`, `dayT(state)`, `dayPhase(state)`,
   `dayFactor(state)`.
2. §3.2: "Day/night cycle" bullet — the phase map, `FRESH_START_T`, the evening rhythm
   (idle gathering drift to deterministic warm spots; rests committed during `'dusk' | 'night'`
   stretch ×`EVENING_REST_SCALE`; everything else untouched).
3. §3 persist: schema v5 + migration chain (v4 → v5 default fresh morning).
4. §6: batch-8 line — **no UI additions**; the sky is the clock.
