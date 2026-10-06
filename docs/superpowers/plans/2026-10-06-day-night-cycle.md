# Day/Night Cycle Implementation Plan (batch 8)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (recommended). **Repo adaptation (binding):** each task below is one file-disjoint free-model
> dispatch; implementers NEVER run git, the browser, or `pnpm dev` — the orchestrator runs the
> freeze gate, the live pass, and commits per task. Steps use `- [ ]` checkbox syntax for
> tracking.

**Goal:** The village lives an 8-minute day — light, sky and glows ease from morning through a
golden dusk into a readable blue-hour night; after dark idle villagers gather to warm spots by the
fire and evening rests stretch; everything saves and resumes exactly (schema v5).

**Architecture:** A deterministic sim-owned clock (`state.clock.dayMs`, advanced in `tick()`),
three pure derivations (`dayT`/`dayPhase`/`dayFactor`), two evening rules that never touch
assignment authority, and a pure canvas-free render pipeline (`daylight.ts`) that interpolates the
frame's lighting between the shipped day strip and a twilight strip; structures/ambient layers add
the dusk glows and the species swap.

**Tech Stack:** TypeScript, three.js (no new dependencies), vite, vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-day-night-cycle-design.md`

## Global Constraints

- No new dependencies. No `any`. No new UI (three zones untouched; the sky is the clock).
- The sim stays deterministic: no `Math.random`, no `Date.now`, no wall-clocks — only `tick`'s
  `dtMs`. All new sim logic is pure over state.
- Palette guardrails: muted, warm accents preserved, no pure black or pure white in any new value.
- Schema target **v5** (after batch 7's v4); chain **v1 → v2 → v3 → v4 → v5** with the
  post-migration `isPlausibleState` re-validation on every branch.
- Baseline: **260/260, 13 files** before this wave; it must stay green plus your additions.
- Concurrent tree: touch only your task's files. If `tsc`/tests fail only in files another task is
  mid-editing, note it and re-run — do not fix theirs. Free models may hit transient rate limits:
  retry the gate a few times before reporting.

## Review Focus

1. **Extreme `dt` spanning the wrap** (e.g. one tick of `DAY_MS × 17`): the clock must land exactly
   where it would have ticked to, finite and in `[0, DAY_MS)` — test in **N1**.
2. **Assignments always beat the evening drift**: an `assignTask` mid-drift retargets in the same
   call; by day the drift never fires — tests in **N1**.
3. **Evening rest stretch is scoped**: only rests *committed* at `'dusk' | 'night'` stretch; day
   rests and every non-rest timer (work, cook, walk, fed) are byte-identical — tests in **N1**.
4. **No noon regression**: at `dayFactor 1` the lighting strip equals the shipped day values
   exactly; guardrails hold at the twilight end — tests in **N3**.
5. **Ancient saves wake correctly**: v1–v4 fixtures load at fresh morning with the village intact —
   tests in **N2**.

---

### Task N1: Sim — clock, derivations, gathering drift, evening rest stretch

**Files:**
- Create: `src/sim/clock.ts` (constants + pure derivations)
- Modify: `src/sim/types.ts` (Clock + GameState), `src/sim/index.ts` (createInitialState, tick,
  drift, rest commit, re-exports), `src/sim/tasks.ts` (any rest-duration constants it owns)
- Test: `src/sim/daynight.test.ts` (new)
- Also allowed (additive fixture repair only, if `tsc` breaks): `src/ui/derive.test.ts`,
  `src/ui/structure-card.test.ts` — add `clock` to their state factories; no expectation changes.

**Interfaces:**
- Consumes: existing `GameState`, `tick`, `createInitialState`, the arrival-walk machinery, `rng`/`hash01`.
- Produces (the rest of the wave depends on these exact names/types):
  `Clock { dayMs: number }`; `GameState.clock: Clock`;
  `DAY_MS = 480_000`; `FRESH_START_T = 0.25`; `EVENING_REST_SCALE = 1.5`; `WARMING_RADIUS = 2.4`;
  `dayT(state): number`; `dayPhase(state): 'night' | 'dawn' | 'day' | 'dusk'`;
  `dayFactor(state): number`.

- [ ] **Step 1: Write the failing tests in `src/sim/daynight.test.ts`**

Boundaries are integer ms: `43_200` (night→dawn), `105_600` (dawn→day), `374_400` (day→dusk),
`436_800` (dusk→night). Clock advance runs on `tick`'s `dtMs > 0` path.

```ts
it('advances with dt and wraps exactly once under a giant dt', () => {
  const st = createInitialState();
  st.clock.dayMs = DAY_MS - 100;
  tick(st, 100);
  expect(st.clock.dayMs).toBe(0);
  st.clock.dayMs = DAY_MS * FRESH_START_T;
  tick(st, DAY_MS * 17);
  expect(st.clock.dayMs).toBe(DAY_MS * FRESH_START_T); // same spot, one modulo
});
it('fresh games start mid-morning', () => {
  expect(createInitialState().clock.dayMs).toBe(DAY_MS * FRESH_START_T);
});
it('phase boundaries sit exactly at the pinned ms', () => {
  const st = createInitialState();
  const at = (ms: number) => { st.clock.dayMs = ms; return dayPhase(st); };
  expect(at(0)).toBe('night'); expect(at(43_199)).toBe('night'); expect(at(43_200)).toBe('dawn');
  expect(at(105_599)).toBe('dawn'); expect(at(105_600)).toBe('day');
  expect(at(374_399)).toBe('day'); expect(at(374_400)).toBe('dusk');
  expect(at(436_799)).toBe('dusk'); expect(at(436_800)).toBe('night');
});
it('dayFactor is 1 by day, 0 by night, ½ at ramp midpoints', () => {
  const st = createInitialState();
  const at = (ms: number) => { st.clock.dayMs = ms; return dayFactor(st); };
  expect(at(105_600)).toBe(1); expect(at(240_000)).toBe(1); expect(at(374_400)).toBe(1);
  expect(at(0)).toBe(0); expect(at(436_800)).toBe(0);
  expect(at((43_200 + 105_600) / 2)).toBeCloseTo(0.5, 6);  // dawn midpoint
  expect(at((374_400 + 436_800) / 2)).toBeCloseTo(0.5, 6); // dusk midpoint
});
```

Gathering drift (behavioral, deterministic — reuse the `runUntil` helper pattern from
`src/sim/food.test.ts`):

```ts
it('idle villagers stroll to their warm seat after dark and idle there', () => {
  const st = createInitialState();
  st.clock.dayMs = 0; // deep night
  const v = st.villagers[0];
  v.pos = { x: 8, z: 8 }; v.state = 'idle'; v.task = null;
  runUntil(st, () => v.state === 'idle' && Math.hypot(v.pos.x, v.pos.z) < 3.0, 30_000, 50);
  const r = Math.hypot(v.pos.x, v.pos.z);
  expect(r).toBeGreaterThan(2.0); expect(r).toBeLessThan(3.0); // WARMING_RADIUS ± jitter
});
it('seats never overlap (distinct angles)', () => {
  // place villagers 0 and 1 idle far away at night, let both arrive,
  // expect the distance between their seats > 0.5
});
it('never drifts by day', () => {
  const st = createInitialState();
  st.clock.dayMs = 240_000; // noon
  const v = st.villagers[0];
  v.pos = { x: 8, z: 8 }; v.state = 'idle'; v.task = null;
  runUntil(st, () => false, 30_000, 50); // 30 s sim
  expect(Math.hypot(v.pos.x - 8, v.pos.z - 8)).toBeLessThan(0.001);
});
it('an assignment mid-drift retargets in the same call', () => {
  const st = createInitialState();
  st.clock.dayMs = 0;
  const v = st.villagers[0];
  v.pos = { x: 8, z: 8 }; v.state = 'idle'; v.task = null;
  runUntil(st, () => v.state === 'walking', 5_000, 50); // drift started
  assignTask(st, v.id, 'chop');
  expect(v.task).toBe('chop'); // target switched immediately; walk continues to the tree
});
```

Evening rest stretch:

```ts
it('rests committed at night run 1.5×; by day they are byte-identical', () => {
  // plain rest, night (dayMs 0): assign rest → run to 'resting' → restMs === 6000
  // meal rest, night: pot.meals 1 + fire ≥ 33 + fedMs 0 → arrival eats → restMs === 8250
  // the same two setups committed at dayMs 240_000 → restMs 4000 / 5500 (byte-identical to today)
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `pnpm exec vitest run src/sim/daynight.test.ts` — expect failures on missing `clock`,
`dayPhase`, `dayFactor` (and tsc red).

- [ ] **Step 3: Implement `src/sim/clock.ts` + state + tick advance**

`clock.ts`: `DAY_MS`, `FRESH_START_T`, integer boundary constants (derived as
`DAY_MS * 9 / 100` etc., so no float edges), `EVENING_REST_SCALE`, `WARMING_RADIUS`, and the three
pure derivations (`dayT` = `dayMs / DAY_MS`; `dayPhase` by the integer boundaries; `dayFactor` =
`1` in day, `0` in night, smoothstep `t*t*(3−2t)` over each ramp — exact `0.5` at midpoints).
`types.ts`: `Clock` + `GameState.clock`. `index.ts`: `createInitialState` sets
`clock = { dayMs: DAY_MS * FRESH_START_T }`; `tick` advances `dayMs = (dayMs + dtMs) % DAY_MS`
inside the `dtMs > 0` region (before the villager loop); re-export the five surface names.

- [ ] **Step 4: Implement gathering drift + rest stretch (all in `src/sim/index.ts`)**

Drift: in the villager loop, when `dayPhase(state)` is `'dusk' | 'night'` and a villager is
`'idle'` with `task === null` and farther than ~0.35 u from their warm seat, start a slow
position-target walk (reuse the arrival-walk machinery; pace ≈ half the existing walk speed). Warm
seat: `angle = (index + 0.5) * 2.399963`, `radius = WARMING_RADIUS ± 0.2` via `hash01(index, salt)`.
On arrival → `'idle'`. The drift check must never fire while a task or target exists; by day it is
inert. `assignTask` needs no change (its retarget path already wins) — prove it in the test.

Rest stretch: at every site where `restMs` is committed, multiply by `EVENING_REST_SCALE` when
`dayPhase(state)` is `'dusk' | 'night'` (plain rest 4000 → 6000; meal rest 5500 → 8250). Do not
touch work/cook/walk/fed timers.

- [ ] **Step 5: Repair any missing-`clock` fixture breaks, then run the full gate**

Add `clock` to the two UI test factories only if `tsc` reports them (additive, no expectation
changes — the H3b/T3b precedent). Then:
`pnpm exec tsc --noEmit` · `pnpm build` · `pnpm test` — 260 baseline + your new tests, green.

- [ ] **Step 6: Report + stop** (orchestrator gates and commits; implementers never commit)

---

### Task N2: Persist — schema v5

**Files:**
- Modify: `src/persist/index.ts`, `src/persist/index.test.ts`

**Interfaces:**
- Consumes: `Clock`, `DAY_MS`, `FRESH_START_T` from `../sim` (**N1 lands these concurrently**; if
  the gate fails only on these names, wait ~60 s and re-run — repeat a few times; if they still
  don't exist when your code is complete, report DONE_WITH_CONCERNS with the gate marked pending-N1).
- Produces: `VERSION = 5`; v4→v5 migration; v5 validation rule.

- [ ] **Step 1: Write the failing tests**

```ts
it('v4 → v5 wakes on a fresh morning', …);        // clock = { dayMs: DAY_MS * FRESH_START_T }
it('v5 round-trip mid-evening restores dayMs exactly', …); // dayMs 400_000 → save/load → 400_000
it('invalid clocks are rejected', …);             // missing · NaN · −1 · DAY_MS · DAY_MS+1 → null
it('v1 → v5 chain keeps the village end-to-end', …); // update the existing v1→v4 chain test
```

- [ ] **Step 2: Run and verify failures** — `pnpm exec vitest run src/persist/index.test.ts`

- [ ] **Step 3: Implement** — `VERSION = 5`; `PreClock`-style types for the older versions;
  `isPlausibleClock` (object, `dayMs` finite, `0 ≤ dayMs < DAY_MS`); `migrateV4toV5`; chain
  v1→v2→v3→v4→v5 with post-migration `isPlausibleState` re-validation on every branch (the
  batch-6 rule). Update existing test titles/fixtures from "v4"/"v1→v4" to "v5"/"v1→v5".

- [ ] **Step 4: Full gate** — `tsc` · `build` · `test`, 260 baseline + yours.

- [ ] **Step 5: Report + stop**

---

### Task N3: Render — the daylight pipeline

**Files:**
- Create: `src/render/daylight.ts`, `src/render/daylight.test.ts`
- Modify: `src/render/index.ts`, `src/render/environment.ts`

**Interfaces:**
- Consumes: `dayFactor(state)` from `../sim` (**N1 concurrent — same retry rule**).
- Produces: `DaylightFrame` (all `THREE.Color` + numbers) and
  `daylightFor(dayFactor: number): Readonly<DaylightFrame>` filling a module-scope scratch
  (allocation-free; document the same-object semantics). Fields: `sky`, `fog`, `ambientSky`,
  `ambientGround`, `ambientIntensity`, `sunColor`, `sunIntensity`, `night`.
  Also changes `Environment.update` to `update(timeSec: number, fire?: Fire, night?: number)`
  (`night` defaults to 0 — old callers stay safe).

- [ ] **Step 1: Write the failing tests in `src/render/daylight.test.ts`**

```ts
it('at dayFactor 1 matches the shipped day palette exactly', () => {
  const f = daylightFor(1);
  expect(f.sky.getHexString()).toBe(PALETTE.sky.slice(1));          // #cfe0ea
  expect(f.fog.getHexString()).toBe(PALETTE.fog.slice(1));          // #d8e4cf
  expect(f.ambientIntensity).toBe(0.8); expect(f.sunIntensity).toBe(1.6);
  expect(f.night).toBe(0);
});
it('twilight respects the guardrails (no pure black/white, muted)', () => {
  const f = daylightFor(0);
  for (const c of [f.sky, f.fog, f.ambientSky, f.ambientGround, f.sunColor]) {
    for (const ch of [c.r, c.g, c.b]) { expect(ch).toBeGreaterThan(8 / 255); expect(ch).toBeLessThan(247 / 255); }
  }
  expect(f.night).toBe(1);
});
it('blends monotonically between the strips', () => {
  const mid = daylightFor(0.5);
  // luminance(day) > luminance(mid) > luminance(twilight) for the sky channel family
});
```

- [ ] **Step 2: Run and verify failures**

- [ ] **Step 3: Implement `daylight.ts`** — DAY keyframes copied from `PALETTE` (sky `#cfe0ea`,
  fog `#d8e4cf`, ambientSky `#cfe0ea`, ambientGround `#7fa653`, ambient 0.8, sun `#ffe3b3`, 1.6).
  TWILIGHT keyframes: start from sky `#6b7ba8`, fog `#828cb0`, ambientSky `#7c88b4`, ambientGround
  `#4f5f52`, ambient 0.55, sun `#ffc98f`, 0.95 — inside the guardrails, exact values curated in
  the live pass. `lerpColors` into the scratch; `night = 1 − dayFactor`.

- [ ] **Step 4: Wire `src/render/index.ts`** — each frame after `dayFactor(state)`:
  `renderer.setClearColor(frame.sky)`, `scene.fog.color.copy(frame.fog)`,
  `ambient.color.copy(frame.ambientSky)`, `ambient.groundColor.copy(frame.ambientGround)`,
  `ambient.intensity = frame.ambientIntensity`, `sun.color.copy(frame.sunColor)`,
  `sun.intensity = frame.sunIntensity`, `env.update(timeSec, state.fire, frame.night)`.

- [ ] **Step 5: `environment.ts` night scalar** — `update(timeSec, fire = …, night = 0)`: scale the
  flame/ember glow gently by `night` (warmer, rounder after dark). `resolveFire` and all fuel
  behavior stay exact; no allocations added.

- [ ] **Step 6: Full gate** — `tsc` · `build` · `test`, baseline + yours.

- [ ] **Step 7: Report + stop**

---

### Task N4: Render — glows & ambience

**Files:**
- Modify: `src/render/structures.ts`, `src/render/ambient.ts`

**Interfaces:**
- Consumes: `dayFactor(state)` / `dayPhase(state)` from `../sim` (**N1 concurrent — retry rule**).
  Both layers already receive `state` each frame — no `index.ts` change, no new exports.
- RGBA is not needed; all changes are per-frame material scalars (allocation-free).

- [ ] **Step 1: Lantern glow** (`structures.ts`) — the lamp globe ("unlit so it still glows at
  dusk") gets its own `MeshLambertMaterial`; per frame `emissiveIntensity` ramps with
  `night = 1 − dayFactor(state)` (warm `#f6d9a0`, intensity ≈ `0.9 × night`). Day = exactly 0.

- [ ] **Step 2: Hut windows** (`structures.ts`) — add a small window quad to each hut's front face
  (shared `windowMat`; dark glass base + warm emissive `#ffd9a0` ramped by `night × 0.85`; ~2 tris
  per hut). Placement chosen against the existing door geometry; exact offsets curated live.

- [ ] **Step 3: Species swap** (`ambient.ts`) — birds and butterflies: fade out through dusk and
  return at dawn (deterministic ramp on `dayFactor`; e.g. scale 0 when `dayFactor < 0.35`, eased
  above). Motes → fireflies at night: material color toward warm ember (`#ffe1a0`), drift speed
  ×0.6, global gentle opacity pulse (`sin(timeSec × 0.9)` breathing, amplitude ≈ 0.15; set
  `transparent` once at build). Day restores the shipped color/speed/opacity exactly. Species
  count stays three; no new objects.

- [ ] **Step 4: Full gate** — `tsc` · `build` · `test` (no unit tests for these layers; the
  orchestrator live-verifies with pinned `dayMs` screenshots).

- [ ] **Step 5: Report + stop**

---

## Execution (orchestrator)

Wave N dispatches in parallel on **free models**: N1 muse-spark · N2 mimo · N3 space-bunny#xhigh ·
N4 space-bunny#xhigh (second session) — fallbacks longcat / nemotron / ling on rate limits. N2–N4
consume N1's fresh surface (retry-in-place while it lands). Before dispatch the orchestrator
applies the spec's Part 8 DESIGN amendments (§3 surface, §3.2 cycle bullet, §3 persist v5, §6
no-UI line). Then: freeze gate → **live pass** (pin
`dayMs` to dawn/day/dusk/night for screenshots; reload mid-evening; lantern + windows + fireflies
at night; birds/butterflies gone after dark; idle gathering visible; one sampled evening rest at
1.5×) → per-task commits → REPORT ledger → independent review (mimo) → fix round.

## Self-Review Notes

- Spec coverage: clock+rhythm (N1), v5 (N2), light pipeline (N3), glows/species (N4) — every spec
  part has a task; UI needs none by design.
- Type consistency: `dayT`/`dayPhase`/`dayFactor` names and `Clock` shape are identical across N1's
  Interfaces block and N2–N4's consumes; `daylightFor`'s frame fields match N3's wiring step.
- The five Review Focus lines each name their owning task's test above.
