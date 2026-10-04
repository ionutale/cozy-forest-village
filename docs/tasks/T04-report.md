# T04 Report — Villagers: primitive characters with hats + procedural animation

Status: **DONE**. All acceptance criteria verified, including live browser validation.
Changes left uncommitted in the working tree per the task rules.

## Files

| File | Lines | Change |
|---|---|---|
| `src/render/villagers.ts` | 211 | **new** — `createVillagers()` / `VillagersLayer` |
| `src/render/index.ts` | 130 (+14) | creates the layer once, updates it with the real `dtMs`, disposes it |
| `src/render/palette.ts` | 20 (+2) | added `skin: '#e2b58d'`, `tunic: '#b5895f'` |

Validation artifacts (evidence, same convention as T01/T03):

- `docs/validation/T04-idle.png` — 8 villagers around the clearing, 8 distinct hats
- `docs/validation/T04-closeup.png` — close-up: big head, cone hat + darker pom, small arms
- `docs/validation/T04-chop-closeup.png` — mid-chop, after wheel-dolly-in
- `docs/validation/T04-mixed-states.png` — villager resting inside the campfire ring

No other files touched (`git status`: only the two edited files, the new source file, and the
PNGs). No new dependencies, no `any`, no textures, no CSS, no second rAF.

## What was built

**Character build** — one `THREE.Group` per villager, all geometry shared:

| Part | Geometry | Notes |
|---|---|---|
| Body | `SphereGeometry(0.17,12,8)` scaled `(1,1.45,1)` | ~0.49u tall, radius ~0.17, `PALETTE.tunic`, small body |
| Head | `SphereGeometry(0.15,14,10)` | radius 0.15 — big-head proportion, `PALETTE.skin` |
| Hat | `ConeGeometry(0.17,0.2,10)` | `villager.hatColor`, base wider than the skull so it reads at distance |
| Pom | `SphereGeometry(0.05,8,6)` | same hue at 0.8× value |
| Arms ×2 | `CapsuleGeometry(0.045,0.09,3,8)` | 0.18u, pivoting at shoulder `y=0.44`, `x=±0.185` |

Total height ≈ 0.97u (head top 0.75 → hat tip 0.91 → pom 0.97). Every mesh sets
`castShadow = true` (verified: villagers drop shadows in the close-up screenshot).
Body, head and arm geometry is shared across all 8; `tunic` and `skin` are single shared
materials. Hat/pom materials are cached per color string, so the 8 roster colors yield
8 material pairs and any repeat reuses them.

**Animation** — purely procedural from `timeSec`/`dtMs` + `villager.state`/`task`:

- Turn: `facing += angleDelta(facing, state.facing) * (1 - exp(-dtMs * 0.012))`, shortest arc,
  so a 180° flip takes the short way round and eases instead of snapping.
- Position: group is set to `state.pos` directly (the sim already integrates at 2.2 u/s, so
  there is nothing to lerp and nothing to teleport).
- Idle: `sin` bob ±0.015u at ~1.8 rad/s, arms still.
- Walking: `|sin|` step bob (0.03u) + 0.06 forward lean + opposite arm swing ±0.5 rad at
  ~1.2 Hz.
- Working: pulse `0.5 + 0.5*sin(2π·hz·t)` driving a forward lean — `chop` 0.19 rad @ 2.2 Hz,
  `berries` 0.1 rad @ 1.3 Hz — plus a small coupled arm lift.
- Resting: slow ±0.02u breathing bob, no lean.
- **Anti-snap (pillar 4):** bob, lean and arm swing are all exponentially approached
  (`1 - exp(-dtSec*9)`), so a state change (walk → work, work → idle) can never jump.
- Per-villager `phase = hash01(index, 71) * TAU` (deterministic, no `Math.random`) keeps the
  8 from breathing in lockstep.

All visual state (`facing`, `phase`, eased bob/lean/swing) lives in a private
`Map<string, Rig>` inside the layer — nothing added to the sim. Rigs are created lazily on
first sight of a villager id and removed if an id disappears, so the layer tolerates roster
changes. `dtMs` is clamped to `[0,100] ms` before use so a tab-switch stall cannot fling a
villager across the map.

## Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` (tsc + vite build) | exit 0 — `dist/assets/index-MW9HdTGV.js 577.76 kB │ gzip: 145.72 kB` |
| `pnpm test` | exit 0 — 3 files, 17 tests passed |

## Browser validation (chrome-devtools, `pnpm dev` on :5199)

Console: clean — only the two `[vite] connecting…/connected` debug lines, no warnings or
errors, at idle and after heavy task churn.

`__cozyRender.info()` (total scene, not just villagers):

| Moment | calls | triangles | geometries | textures |
|---|---|---|---|---|
| 8 villagers idle at spawn | 110 | 28 624 | 15 | 2 |
| mixed states after ~2 min of chopping | 99 | 27 156 | 15 | 2 |

`calls` stays in the 99–110 band (frustum culling moves it around), under the `< 120`
budget. `triangles` ~27k, far under 500 000. `geometries: 15` confirms the villager parts
really are shared — 5 villager geometries upload once, not 8×5.

Behavior, driven through the real UI (click villager → click task) and read back via
`__cozy.getState()`:

- **`chop` (Maple):** `walking` toward `targetNodeId` of kind `tree`, distance to target fell
  4.90 → 0.42; max per-frame position step **0.0387u** (= 2.2 u/s at 60fps — no teleporting).
  On arrival `state` flipped to `working`, `distToTarget` 0.423 (≤ 0.45 arrival radius),
  `progressMs` accumulated and `resources.wood` climbed 19 → 22 in ~4.3s (3 yields at
  1400 ms each). `facing` 1.324 matched `atan2` to the target exactly.
- **`berries` (Fern):** target resolved to a `bush`, arrival distance 0.424,
  `resources.berries` 19 → 22.
- **`rest` (Birch):** walked to the campfire, distance 3.65 → 1.82 → 0.43, `state` became
  `resting`; after the 4000 ms rest timer it returned to `idle` with `task: null`.
- Max per-frame position step stayed **0.0387u** across all three, so nothing snapped or
  teleported. Turn smoothing could not be read numerically (the scene graph is not exposed on
  `window`), so it is verified by construction (`angleDelta` + exponential approach) and
  visually — no visible rotation jumps in the idle/walking screenshots.

## Deviations

1. **Hat materials are per-color, not literally one shared material.** With 8 distinct
   `hatColor` values a single material cannot represent the roster, and the brief calls the
   hat the identity cue. Resolution: geometry is shared across all 8, and hat/pom materials
   are cached by color string, so each distinct color allocates exactly one cone + one pom
   material and any duplicate color reuses them. Skin and tunic remain single shared materials
   as specified.
2. **Eased animation channels beyond the brief.** The brief only required smoothing on the
   turn. I also ease bob/lean/swing, because `pose()` switches per sim state and a raw switch
   would visibly pop (which pillar 4 forbids). Same cost, one extra `k`.
3. **`performance.now()` called once per frame instead of twice.** The brief wrote
   `layer.update(state, performance.now() / 1000, dtMs)`; I hoisted it into a local and pass
   the same `timeSec` to `env.update()` and `villagers.update()` so both layers agree on the
   frame time to the microsecond.
4. **Small guards inside `update`:** `dtMs` clamped to `[0,100]`, and stale rigs pruned when a
   villager id leaves the state. Neither was requested; both prevent a visual pop on tab
   regather and on roster change.

## Known gaps / concerns for the orchestrator

1. **Draw calls are close to the ceiling.** Villagers add 48 draw calls (8 × 6 meshes), which
   is what the brief's "one `THREE.Group` per villager" implies. Scene total measured 99–110
   against a `< 120` budget. **T6 (ambient life) will likely breach it.** Mitigations, none of
   which I took because they are outside T04: instance the body/head/arms (they share geometry
   and material already, so per-instance matrices would work and would collapse ~32 calls),
   or raise the budget in the validation criteria. Worth a ruling before T6.
2. **Resting villagers stand inside the campfire ring, overlapping the flame cone** — visible
   in `docs/validation/T04-mixed-states.png`. Root cause is sim-side, not render-side: the
   campfire node is at the ring centre and `ARRIVAL_DISTANCE = 0.45` < ring radius 0.92, so a
   resting villager parks at ~0.43 from the fire and the 1.05u flame overlaps their 0.97u
   body. It reads as standing in the fire, which is not cozy. Fixing it means either a rest
   offset in the sim (T2) or a render-side rest-position nudge (T05/T06). Out of T04 scope —
   flagging rather than touching.
3. **Characters are legless blobs by design.** No legs/feet (the brief specifies body + head +
   hat + arms only), so walking is conveyed by bob + arm swing + lean. That reads acceptably
   at the default camera distance in the screenshots, but it is the weakest part of the
   silhouette if the camera is ever brought low.
4. **Arms hang outside the body silhouette** at `x=±0.185` vs body radius 0.17, so from some
   angles they read as nubs on the side rather than arms. Cosmetic; visible in the close-up.
5. **Not covered by automated tests.** The brief's file allow-list is only the three source
   files, so I added no test file for `angleDelta`/easing. Those two helpers are pure and would
   be cheap to unit test if the orchestrator wants a later task to widen the allow-list.
6. The dev server I started on port 5199 for validation has been stopped (port confirmed
   free), so the tree is clean apart from the intended changes.
