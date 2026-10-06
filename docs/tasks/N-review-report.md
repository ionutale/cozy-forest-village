# Independent review — batch 8 day/night cycle (wave N)

**Reviewer:** fresh independent pass (not the previous wave's reviewer).
**Scope:** spec `docs/superpowers/specs/2026-10-06-day-night-cycle-design.md`, plan
`docs/superpowers/plans/2026-10-06-day-night-cycle.md`, DESIGN §3 / §3.2 / §3 persist / §6, the four
task reports, and the wave diff `6712970` (N1) · `822af34` (N2) · `bed638e` (N3) · `a4f5c19` (N4) ·
`ea62cfd` (docs).
**Method:** read the committed files against the spec line-by-line; diffed each task; ran the gate.

**Gate (re-run by this review):** `pnpm exec tsc --noEmit` → exit 0. `pnpm test` → **278 passed, 15
files** (matches the stated baseline). Working tree clean; no files modified by this review except
this report.

**Verdict:** the wave is faithful to the spec and safe to keep. No Critical or blocking defect
found. The clock, derivations, drift, rest stretch, v5 chain and daylight pipeline all match the
binding rules, and the day/`night === 0` paths are byte-preserving by construction. The remaining
issues are two test-coverage gaps on Review-Focus pin 3 and a handful of cosmetic/spec-letter
deviations.

---

## Findings

### Important

**I1 — Review-Focus pin 3 is under-covered: no test pins the non-rest timers or run-to-run
determinism.**
`src/sim/daynight.test.ts:155-192` (and the file as a whole). The spec Part 6 requires that "work,
cook, walk, and fed timers are untouched" and that "the drift is deterministic across identical
runs", and the plan's Review-Focus 3 names "every non-rest timer is byte-identical" as an N1 test.
The suite tests only `restMs` (6000/8250 vs 4000/5500); it never asserts `progressMs`/`fedMs` of a
work/cook villager are unchanged by the batch, and it never compares two identical runs. The code is
safe by construction (`restScale` returns exactly `1` by day and only the three `restMs` sites were
touched — confirmed in the `6712970` diff), but the pin is not actually held by a test, so a future
edit to the shared `walk()` path could regress work/cook/fed with nothing catching it.
*Minimal fix:* add one table test that settles a chopper and a cook at `dayMs 240_000` and asserts
`progressMs` climbs at exactly `WORK_PERIOD_MS`/`COOK_CHANNEL_MS` with `fedMs` decaying as before
(i.e. snapshot the same scenario against a pre-batch expectation), plus a two-run deep-equal
determinism check of a fixed dusk scenario.

**I2 — The "seats never overlap" test can pass vacuously.**
`src/sim/daynight.test.ts:102-126`. `runUntil` (`:20-26`) returns silently when its budget is
exhausted, and the test's only real assertion is `distance(a,b) > 0.5`. If the drift never fired,
both villagers would remain at their spawn points `(8,8)` / `(-8,-8)` — idle and ~22 units apart —
so the assertion passes without the seats ever being exercised. The predicate that would prove the
walk happened lives only inside `runUntil` and is never reported.
*Minimal fix:* make `runUntil` return whether it satisfied the predicate and assert it, or, after the
call, assert `Math.hypot(a.pos.x, a.pos.z) < 2.8 && Math.hypot(b.pos.x, b.pos.z) < 2.8` before the
distance check. (The seat-distinctness itself is guaranteed by `(index + 0.5) × golden angle`; it is
only the test that is weak.)

### Minor

**M1 — Fireflies are not "slightly denser near the fire" (spec Part 4).**
`src/render/ambient.ts:159-181` (fixed `moteBase` scatter, `r ≤ 20`) and `:230-235` (only the sine
drift is recolored/sped). Spec Part 4 lists the night motes as "warmer color, slower drift, a gentle
blink, **slightly denser near the fire**"; the approved plan Step 3 dropped the density clause and
the implementation followed the plan, so the fireflies keep the shipped uniform distribution.
*Minimal fix:* at night bias a weighted subset of `moteBase` toward the origin (e.g. multiply
`sqrt(hash01)` radius by `(1 − 0.5·night)`), or record the drop as an intentional deviation in the
spec/plan so the letter and the code agree.

**M2 — Golden angle duplicated as a bare literal.**
`src/sim/index.ts:91` defines `WARM_SEAT_ANGLE = 2.399963` "same value as tasks.ts", while
`src/sim/tasks.ts:31` owns `const GOLDEN_ANGLE = 2.399963` (not exported). Two copies of a binding
constant can silently diverge.
*Minimal fix:* export `GOLDEN_ANGLE` from `tasks.ts` and import it in `index.ts` (delete the local
copy).

**M3 — Mote positions are not byte-identical to pre-batch at day (phase offset).**
`src/render/ambient.ts:99,227,232-234`. The mote sine phase now uses the integrated `driftSec`
(0 at layer creation) instead of `timeSec` (`performance.now()/1000`). Colour, speed and opacity are
exactly restored (verified: `copy(moteDay).lerp(moteNight, 0)` and factor `1`), but the *positions*
of the motes at a given wall-clock differ from the pre-batch build by a constant phase. The spec's
Part 4 "revert at dawn" and the plan's "restores the shipped color/speed/opacity exactly" do not
require position identity, so this is acceptable — but it is the one place where day is not
pixel-for-pixel the old build.
*Minimal fix:* seed `driftSec = performance.now() / 1000` at layer creation if position identity is
wanted; otherwise leave and note it.

**M4 — Lantern globe material switched `MeshBasicMaterial` → `MeshLambertMaterial`.**
`src/render/structures.ts:186-188`. The globe is now light-shaded by day (emissive `0`), where
pre-batch it rendered unlit at full `PALETTE.sun`. This changes the lantern's daytime appearance,
not just its dusk glow. The plan Step 1 explicitly asked for `MeshLambertMaterial`, so it is
sanctioned, and there is no test for either the old or new look.
*Minimal fix:* confirm the live pass accepted the new daytime look (it is only mentioned via "exact
offsets curated live"); if not, keep the globe unlit and drive only the emissive ramp.

**M5 — `daylightFor` scalar monotonicity is not asserted.**
`src/render/daylight.test.ts:44-58` checks only Rec. 709 luminance of `sky`/`fog`/`ambientSky`;
`ambientIntensity` and `sunIntensity` (both pure `mix()` outputs) have no monotonicity/endpoint
assertion beyond the `dayFactor 1` values.
*Minimal fix:* assert `ambientIntensity` and `sunIntensity` increase strictly across
`0 < 0.5 < 1` (0.55→0.8, 0.95→1.6).

---

## Review-Focus pin coverage (plan §"Review Focus")

| # | Pin | Status | Evidence |
|---|---|---|---|
| 1 | Reload mid-evening resumes exact `dayMs` | ✅ real test | `src/persist/index.test.ts:370-384` (`dayMs 400_000` round-trip) |
| 2 | Giant-`dt` wrap keeps the clock exact | ✅ real test | `src/sim/daynight.test.ts:29-37` (incl. `DAY_MS × 17`) |
| 3 | Evening rhythm deterministic / never fights the player; drift idle-only; assignment interrupts; day + non-rest timers byte-identical | ⚠️ partial | drift-arrive `:89-100`, day-inert `:128-137`, mid-drift assignment `:139-152`, rest stretch `:156-192`. **Missing:** non-rest timer byte-identity, determinism across runs (I1); seats test vacuous (I2) |
| 4 | `daylightFor` guardrails / no noon regression / monotonic | ✅ real test | `src/render/daylight.test.ts:17-58` (day exactness, twilight guardrails, luminance monotonic) |
| 5 | v1 → v5 chain stays intact end-to-end | ✅ real test | `src/persist/index.test.ts:256-298` (village intact + clock default) |

**Known live-only gaps (as flagged):** lantern/window emissive, species fade and firefly
colour/speed/opacity are live-verified, not unit-tested (plan N4 Step 4 intentionally); and
`src/ui/index.ts` still has no DOM test (no UI was added this batch, so nothing here is new).

---

## Spot-checks that pass (for the record)

- Clock: single modulo `state.clock.dayMs = (dayMs + dtMs) % DAY_MS` in the `dtMs > 0` region,
  before the villager loop (`src/sim/index.ts:276-279`); `DAY_MS - 100 + 100 → 0` and `0.25·DAY_MS +
  17·DAY_MS → 0.25·DAY_MS` are exact in IEEE-754. Boundaries derived as integer ms
  (`src/sim/clock.ts:15-18`); 0.5 midpoints exact.
- Derivations are pure reads of `state.clock.dayMs`; boundary constants are exactly
  43 200 / 105 600 / 374 400 / 436 800.
- Drift: fires only for `'idle' && task === null` under `evening` (`src/sim/index.ts:344-374`);
  `'walking' + task === null` is reachable only via the drift, so the `drifting` flag is exact
  (`:516-540,600-610`); `assignTask` is untouched and its retarget path wins in the same call.
- Rest stretch wraps all three `restMs` commit sites (`:627,631,635`); `restScale` is `1` by day and
  the `6712970` diff touches no work/cook/walk/fed timer.
- Persist: `isPlausibleClock` (`src/persist/index.ts:179-183`), `migrateV4toV5` default
  `DAY_MS × FRESH_START_T` (`:247-249`), and `isPlausibleState` re-validation on every branch
  (`:267-300`).
- Render: DAY strip equals the shipped palette/intensities exactly at `dayFactor 1`; twilight sun
  `#f6c98f` (not the plan's `#ffc98f`) is the correct call — the plan's own literal has R = 255/255,
  which the same spec's `(8/255, 247/255)` guardrail forbids (documented at
  `src/render/daylight.ts:44-56`). `night = 1 − dayFactor`; scratch semantics documented and
  consumed in-frame (`src/render/index.ts:175-188`); `resolveFire`/fuel untouched
  (`src/render/environment.ts:36-41`); `Environment.update` defaults `night` to 0.
- N4: shared `lampMat`/`windowMat` written once per frame (`src/render/structures.ts:494-500`) and
  exactly `0` at `dayFactor 1`; a single 2-tri window quad per hut on the `+z` front face
  (`:388-393,404-410`); species fade below `dayFactor 0.35` via smoothstep and restored to scale 1
  by day (`src/render/ambient.ts:193-195`); three species, no new dependencies, no UI change.
