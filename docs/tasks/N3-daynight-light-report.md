# N3 — Render: the daylight pipeline

Batch 8 (day/night cycle), task N3. A pure, canvas-free keyframe blend between the shipped day strip
and a curated twilight strip, its per-frame wiring into the scene, and a `night` scalar that warms
the campfire after dark. No new dependencies, no `any`, no `Math.random`, no per-frame allocations.

## Files changed

| File | Change |
|---|---|
| `src/render/daylight.ts` | **new** — `DaylightFrame`, `daylightFor(dayFactor)`, keyframe strips, scratch frame, `mixColor`/`mix` |
| `src/render/daylight.test.ts` | **new** — day exactness, twilight guardrails, monotonic blend (3 cases) |
| `src/render/index.ts` | import `dayFactor` + `daylightFor`; keep a `fog` reference; per-frame sky/fog/hemisphere/sun wiring; pass `frame.night` to `env.update` |
| `src/render/environment.ts` | `update(timeSec, fire?, night?)`; scale the flame/ember/warm-light glow by `night` (default 0) |
| `docs/tasks/N3-daynight-light-report.md` | this report |

## Step 1 — `src/render/daylight.ts`

`DaylightFrame` carries `sky`, `fog`, `ambientSky`, `ambientGround`, `ambientIntensity`, `sunColor`,
`sunIntensity`, `night` (all `THREE.Color` + numbers). `daylightFor(dayFactor)` fills and returns a
**single module-scope scratch frame** — allocation-free. The same-object semantics are documented at
the top of the file: the result is only valid until the next call, so callers must consume it in the
same frame (render/index.ts copies the colors into the scene immediately).

The two strips:

- **DAY** — the exact shipped palette (`PALETTE.sky/fog/ambientSky/ambientGround`, ambient 0.8,
  `PALETTE.sun`, sun 1.6).
- **TWILIGHT** — sky `#6b7ba8`, fog `#828cb0`, ambientSky `#7c88b4`, ambientGround `#4f5f52`,
  ambient 0.55, sun `#f6c98f`, sun 0.95. Muted blue hour, warm accent preserved.

`mixColor`/`mix` copy the keyframe **exactly** at `t ≤ 0` and `t ≥ 1` and lerp strictly between, so
`dayFactor 1` reproduces the day palette bit-for-bit (no float drift from `a + (b−a)·1`) and
`dayFactor 0` the twilight strip exactly. `night = 1 − dayFactor`. A non-finite input clamps to deep
night (0), matching the sim's defensive style.

**One deviation from the spec's literal tones (see Concerns):** the spec's twilight sun `#ffc98f`
has a red channel of `255/255`, which fails the same spec's `(8/255, 247/255)` guardrail for every
twilight channel. I nudged only that channel to `#f6c98f` (246) — hue essentially unchanged — so both
the guardrail test and DESIGN §2's "no pure black/white" rule hold.

## Step 2 — `src/render/daylight.test.ts`

Three cases (Review Focus 4):

1. **Day exactness** — at `dayFactor 1`, every color's `getHexString()` equals `PALETTE` (minus `#`),
   `ambientIntensity 0.8`, `sunIntensity 1.6`, `night 0`.
2. **Twilight guardrails** — at `dayFactor 0`, every channel of every color is in
   `(8/255, 247/255)`; `night 1`.
3. **Monotonic blend** — for the sky family (`sky`, `fog`, `ambientSky`), Rec. 709 luminance at
   `dayFactor 1` > `0.5` > `0`. Each frame's numbers are read into a fresh plain object immediately,
   since the scratch aliases.

## Step 3 — wiring `src/render/index.ts`

`const frame = daylightFor(dayFactor(state))` once per frame, then `setClearColor(frame.sky)`,
`fog.color.copy(frame.fog)`, `ambient.color` / `ambient.groundColor` / `ambient.intensity`,
`sun.color` / `sun.intensity`, and `env.update(timeSec, state.fire, frame.night)`. `scene.fog` is now
held in a local `fog` reference so `fog.color` needs no null-check (`scene.fog` is
`(Fog | FogExp2) | null` under strict mode).

## Step 4 — `src/render/environment.ts` night scalar

Signature widened to `update(timeSec: number, fire?: Fire, night?: number)`; `night` defaults to 0
and is clamped, so every existing caller (`env.update(timeSec)` / `(timeSec, fire)`) is unchanged.
After dark: flame scale ×`(1 + 0.12·night)`, flame tint lerped 25 % toward the fire hue, fire light
×`(1 + 0.3·night)`, ember opacity ×`(1 + 0.2·night)`, warmth disc ×`(1 + 0.1·night)`. **`resolveFire`
and every fuel rule are untouched**, and at `night 0` every factor is exactly 1 (the tint lerp `t` is
exactly 0), so day behavior is byte-identical. No allocations added.

## Verification

- `pnpm exec tsc --noEmit` — clean.
- `pnpm build` — clean (`tsc --noEmit` + `vite build`).
- `pnpm test` — **278/278 passed, 15/15 files.** My `daylight.test.ts` contributes 3 cases (all pass
  standalone: `pnpm exec vitest run src/render/daylight.test.ts` → 3/3).

**Concurrency wait.** N1 (sim `dayFactor`) landed mid-task, as the dependency note anticipated; the
gate was red only on `dayFactor`/`Clock`/`DAY_MS` from N1 and N2, plus N1's own in-progress state.
Re-ran after ~75 s and ~90 s waits until N1's UI fixture repair cleared the last two `tsc` errors
(`src/ui/derive.test.ts`, `src/ui/structure-card.test.ts`). Nothing in my four files was ever red.

## Concerns / notes for the orchestrator

1. **Twilight sun hue** — spec said `#ffc98f`; used `#f6c98f` to satisfy the guardrail it also
   requires. Curate live; only the red channel moved (255 → 246).
2. **Interpolation is linear**, not eased. `daylightFor` maps `dayFactor` directly, and the sim's
   `dayFactor` is already a smoothstep over the dawn/dusk ramps, so the light eases with the clock.
   If the live pass wants a slower sky change near the horizons, ease inside `daylightFor`.
3. **`night` glow scaling is a first pass** (flame +12 %, light +30 %, embers +20 %, warmth +10 %,
   tint +25 % toward fire). Gently stronger after dark; all tuned live.
4. **Same-object scratch** is the one sharp edge: any future caller that stores the returned frame
   across a second `daylightFor` call will see mutated values. Documented at the top of the module.

## Fix round — review finding M5 (scalar monotonicity)

`docs/tasks/N-review-report.md` M5: `daylightFor`'s `ambientIntensity` / `sunIntensity` (pure `mix()`
outputs) were only pinned at the `dayFactor 1` endpoint, with no monotonicity assertion. Added one
case to `src/render/daylight.test.ts` ("scalar intensities rise strictly and never overshoot"):

- exact midpoints via `toBeCloseTo(…, 6)` — `ambientIntensity` `0.55 → 0.675 → 0.8`,
  `sunIntensity` `0.95 → 1.275 → 1.6`;
- strict increase across `0 < 0.5 < 1` for both;
- a no-overshoot guard sampling `t ∈ {0.25, 0.5, 0.75}` and asserting each scalar stays inside its
  endpoint bracket.

**One correction to the fix brief:** it quoted `ambientIntensity` midpoint `0.7`, but the arithmetic
mean of `0.55` and `0.8` is `0.675`, which is what `mix()` returns (the brief's `sunIntensity` mean,
`1.275`, is correct). The test asserts the true value; a `0.7` literal would have failed by `0.025`.

Gate re-run: `pnpm exec tsc --noEmit` clean · `pnpm build` clean · `pnpm test` **279/279, 15 files**
(the 278 baseline plus this one new case).
