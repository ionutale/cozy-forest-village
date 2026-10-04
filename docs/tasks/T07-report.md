# T07 — Final independent review + 20 improvement proposals

Reviewer: independent read-only pass (fresh model). Scope: `DESIGN.md` (binding), `docs/tasks/T01–T06*`,
the whole `src/` tree, configs.

**Verification actually run (read-only):**
- `pnpm exec tsc --noEmit` → exit 0.
- `pnpm test` → 19/19 pass, 3 files, 189 ms.
- Screenshots re-read: `docs/validation/T03-wide.png`, `T06-t1.png`.
- Two behavioural claims below were **measured**, not guessed: I re-ran the exact deterministic
  math of `src/sim/{rng,villagers,world,tasks}.ts` + `walk()` from `src/sim/index.ts` (seed 1, the
  default) in a throwaway `node -e` script — no repo file was created or modified.

**Scope rules honoured:** only `docs/tasks/T07-report.md` created; no source/config/other doc
touched; nothing committed; no subagents dispatched.

---

## Part A — Final review

**Severity summary: Critical 0 · Important 6 · Minor 6 (12 total, capped).**

No defect was found that breaks the game, the build, or the first playtest — the sim obeys DESIGN
§3/§3.1 exactly (all binding numbers verified literal-by-literal: 2.2 u/s, 0.45 arrival, 1400 ms,
4000 ms, ring 1.6, golden angle 2.399963, squared-distance + id-ascending tie-break, events cleared
at tick start, `facing = atan2(dx, dz)`, no `Math.random`/clocks in `src/sim/`), the UI stays inside
the three zones of §6, tokens.css matches §4 verbatim, and the renderer caps pixel ratio at 2 and
instances the forest per §2.6. The Critical slot is therefore empty by evidence, not by politeness.
The six Important findings are all things a human playtester will hit within the first minute or
within an hour.

---

### Important

#### I1 — Chopping villagers stack on the same tree and interpenetrate (measured)
`src/sim/index.ts:51` (`nearestNode` with no occupancy check) · `src/sim/index.ts:98-102` (arrival
at ≤ 0.45 from the node, no separation).

- **What's wrong:** assigning all 8 villagers to `chop` from the default spawn ring resolves to only
  **3 distinct trees**: `tree-23 → [v1,v2,v8]`, `tree-4 → [v3,v4,v5,v6]`, `tree-13 → [v7]`. After
  arrival the closest pair sits **0.072 u apart** (measured; both stop 0.27–0.43 from their node).
  Bodies are ~0.34 u wide, so they visibly clip into one another — four characters occupying one
  tree.
- **Why it matters:** bulk-assigning everyone to chop is the first thing a player does, and this is
  the first thing they see. It fights DESIGN §2.1 (cohesion) and §2.4 (nothing that reads as broken).
  Rest already solves the same problem with the golden-angle ring (`tasks.ts:54-59`); work did not.
- **Minimal fix:** deterministic per-villager slot at the target — in `walk()`, when the target is a
  work node, offset the arrival point by `angle = villagerIndex × GOLDEN_ANGLE`, `r = 0.55` around
  the node (same idiom as `restSpot`, no RNG, no pathfinding, determinism preserved).

#### I2 — The player can never stop a villager: `assignTask(id, null)` is unreachable from the UI
`src/ui/index.ts:53-59` (popover renders exactly `TASK_ORDER`) · `src/ui/index.ts:125-132`
(`onPopoverClick` requires a truthy `task`, so `null` is never sent).

- **What's wrong:** DESIGN §3 puts `TaskId | null` in the contract and `UIActions.assignTask` accepts
  it (`src/ui/index.ts:4`), but no UI path ever passes `null`. Per §3.1 villagers "keep working until
  reassigned", and `rest` is the only self-terminating task (4 s). So once assigned, wood/berries
  accumulate forever with no undo.
- **Why it matters:** a player who assigns all 8 to chop wants to try berries next, or wants the
  counting to stop — the only lever is Rest, which is not the same thing. It also leaves half of a
  binding contract affordance dead.
- **Minimal fix:** a fourth button, "Idle"/"Stop", in the existing popover (zone 3 — an addition
  *inside* an existing zone, so §6 is respected), calling `actions.assignTask(selectedId, null)`.

#### I3 — Villagers walk straight through the campfire flames on the way to rest (measured)
`src/sim/index.ts:88` (straight line spawn → `restSpot`) with the spawn ring
`src/sim/villagers.ts:20-21` vs the fire geometry `src/render/environment.ts:174-185` (stone ring
r = 0.92, flame cone r = 0.4).

- **What's wrong:** rest spots sit at r = 1.6 spread by the golden angle (137.5° apart), spawns sit
  at 45° apart — for several villagers the chord passes almost exactly through the origin. Measured
  minimum distance from the fire centre over the whole walk, default seed: **v3 = 0.31, v7 = 0.22**
  (both inside the 0.4-radius flame; the other six pass at 1.4–2.0). The T4/T2 fix moved resting
  *positions* off the fire but not the *path*.
- **Why it matters:** a character dissolving into the flame is the least cozy thing in the build and
  it recurs every time those villagers are told to rest.
- **Minimal fix:** one detour waypoint for `task === 'rest'` only — walk spawn → `(r = 2.2, angle
  between spawn and spot on the shorter arc)` → rest spot. **Note: this bends DESIGN §3.1's
  "Movement: straight line (no pathfinding)" and needs an orchestrator ruling before it is
  dispatched.**

#### I4 — Work SFX are unthrottled: the chopping becomes a sustained clatter (measured)
`src/audio/index.ts:165-169` (one voice per event, no cap) · `src/audio/index.ts:113-116`
(`knock()` always at `ctx.currentTime + 0.01`, identical pitch/level every time).

- **What's wrong:** 8 choppers produce **321 yields in 60 s — mean 236 ms between yield ticks, 40
  ticks carrying ≥3 simultaneous knocks, worst case 3 identical knocks in one 100 ms window**. That
  is ~4–5 knocks/s for as long as anyone chops, plus occasional phase-coherent stacking of identical
  oscillators.
- **Why it matters:** DESIGN §2.4/§2.3 want gentle and sparing; the T6 brief said "no event spam".
  The result is a machine-gun loop, not warm feedback, and it is the dominant sound in the game.
- **Minimal fix:** a per-event-type cooldown (~400 ms) plus "at most one SFX per `state.events`
  batch", and ±8 % randomised pitch/level per knock so the rare stack does not phase-align.

#### I5 — Audio voices are never disconnected: possible unbounded node growth over hours
`src/audio/index.ts:40-61` (`voice()` connects `osc → gain → [panner] → master`, calls
`osc.stop(...)`, and never disconnects the chain).

- **What's wrong:** each yield creates 2–3 nodes that stay wired into `master` after playback ends.
  At the measured ~4.2 knocks/s that is ≈ 15k voices/hour of play (plus chirps), none of which the
  code releases. Whether a *finished but still connected* chain is collected is
  implementation-defined — this is the classic WebAudio leak, and long play is explicitly in this
  review's brief.
- **Why it matters:** worst case is steadily growing memory/audio-graph cost over a session that is
  meant to be left running calmly; best case it is free insurance.
- **Minimal fix:** three lines — `osc.onended = () => { try { tail.disconnect(); } catch {} }`
  (and disconnect the panner chain with it).

#### I6 — `tick(state, Infinity)` hangs the tab forever
`src/sim/index.ts:59` (`if (!(dtMs > 0)) return;` — guards 0 and NaN, and the comment claims that is
the invalid-input story) · `src/sim/index.ts:107-108` (`while (villager.progressMs >= 1400) {
villager.progressMs -= 1400; }`).

- **What's wrong:** `Infinity - 1400 === Infinity`, so the loop never terminates. A merely huge
  finite `dtMs` (e.g. `1e9`, the kind of value catch-up code passes after a suspended tab) instead
  spins ~714k iterations and pushes 714k events into `state.events` in one tick.
- **Why it matters:** `sim/` is the deep module every other layer depends on, and it already
  advertises invalid-`dt` handling. It is *not* reachable today — `src/main.ts:68` clamps `dt` to
  100 ms — but that clamp is one edit away from being removed, and the fix costs one line.
- **Minimal fix:** at the top of `tick`: `if (!Number.isFinite(dtMs)) dtMs = 0;` (keeps the existing
  "counters still advance" behaviour), or clamp `dtMs` to a documented ceiling.

---

### Minor

#### M7 — Re-assigning the task a villager already has silently wastes their progress
`src/sim/index.ts:44-53` (every `assignTask` zeroes `progressMs` and forces `state = 'walking'`) ·
`src/ui/index.ts:130` (no same-task guard).

- Clicking "Chop wood" on someone already chopping (a natural "did that register?" reflex) discards
  up to 1399 ms of work, sends them walking 0.22 u back to the node, and fires a second `arrived`
  event. Same for Rest: the 4 s timer restarts, so a player can hold a villager in rest forever.
- **Minimal fix:** in `assignTask`, if `task === villager.task` and the retargeted node id is
  unchanged → return without touching `progressMs`/`state`.

#### M8 — DESIGN §4's palette listing is stale, and one colour still bypasses the palette
`src/render/palette.ts:18-22` (`accent`, `bird`, `mote`, `skin`, `tunic` added by T3/T4/T6 briefs)
· `src/render/environment.ts:188` (`'#ece0c3'` clearing-disc colour hardcoded).

- The binding spec says palette.ts "mirrors the 3D colors" and prints an exact object; the file now
  has five keys the spec does not contain, so the next reader cannot tell spec from drift. The disc
  colour was already logged as a T3 deferral and is still outside the single source of 3D colours.
- **Minimal fix:** add the five keys to DESIGN §4 and move `#ece0c3` into `PALETTE` (one-line
  change in `environment.ts:188`).

#### M9 — Duplicated helpers and dead exports ("belongs in one place")
`hash01` is byte-identical in `src/render/environment.ts:18-21`, `src/render/villagers.ts:43-46`,
`src/render/ambient.ts:29-32` · `mulberry32` is duplicated in `src/sim/rng.ts` and
`src/audio/index.ts:19-28` (the audio copy has a stray no-op `a |= 0`) · `TAU` redeclared in four
files · `REST_RING_RADIUS` exported from `src/sim/tasks.ts:15` but used only inside that file.

- Divergence risk: a tuned hash or PRNG change applied to one copy silently breaks determinism
  between layers. **Minimal fix:** one `src/render/hash.ts` (render-layer only, so `sim/` stays
  self-contained per §3), audio imports `mulberry32` from… nothing — audio may not import `sim`
  internals, so *delete* the duplicate and inline the two-line PRNG into `initAudio`'s closure, or
  keep the copy and drop the misleading `a |= 0`. Un-export `REST_RING_RADIUS` or use it in a test.

#### M10 — Draw calls are ~82 % villagers; the 200-call budget has less headroom than it looks
`src/render/villagers.ts:141-145` (`root.traverse` sets `castShadow = true` on **every** mesh).

- Measured `calls 117` (REPORT T6). Breakdown: 8 villagers × 6 meshes = 48 in the colour pass, and
  the same 48 again in the shadow pass = **~96 of 117**; all environment content is ~14. Any future
  villager detail (tools, log carrier, seated pose) costs ×2 calls.
- Triangles are fine (29.1k / 600k) — calls are the binding constraint. **Minimal fix:** cast shadows
  from torso + head only → −32 calls (≈85 total), before any instancing work.

#### M11 — Feedback gets noisy exactly when there is good news
`src/ui/index.ts:198-204` (yield pulse restarts via `void pill.offsetWidth` on every event frame) ·
`src/ui/index.ts:209` (card label shows the *task*, never the *state*).

- At the measured ~4–5 yields/s the HUD pill is permanently mid-pulse, so the "whisper of feedback"
  becomes a throbbing number; meanwhile a villager still walking to their tree reads "Chop wood",
  identical to one already working — the player cannot tell progress from travel.
- **Minimal fix:** re-arm the pulse at most once per ~600 ms per pill; prefix the label from
  `v.state` (`Walking…` / `Chop wood` / `Resting`).

#### M12 — Leftovers: no error containment in the frame loop, unexercised `dispose()` paths, ledger drift
`src/main.ts:67-75` · `src/render/index.ts:157-168`, `src/ui/index.ts:221-228`,
`src/audio/index.ts:171-178` · `REPORT.md:32-33`.

- One throw anywhere in `tick/render/audio/ui.render` kills `requestAnimationFrame` permanently —
  the game freezes silently with no message (nothing throws today; there is no guard). All three
  `dispose()` implementations are dead code in the running app, so their correctness is unproven
  (`disposeScene` double-disposes geometries already released by the layers — harmless, but
  untested); `window.__cozyAudio` is never cleaned up while `__cozyRender` is (`index.ts:167`).
  `REPORT.md` lists T7 twice ("in progress" and "queued").
- **Minimal fix:** wrap the frame body in `try/catch` that logs once and re-arms the loop; call
  `dispose()` from a `pagehide` handler so those paths actually run; delete the duplicate ledger row.
  (Housekeeping, not player-facing — but these are the deferred items T7 was asked to sweep.)

---

### Sections that are clean (stated explicitly, per brief)

- **Contract signatures:** `src/sim/index.ts`, `src/render/index.ts`, `src/ui/index.ts` match DESIGN
  §3 exactly, including `seed = 1`, event clearing order, and the `onSelect` external/internal
  split (`src/ui/index.ts:93-116`) — the selection paths I traced (card click, 3D click, ground
  click, Escape, outside click) produce **no** ring/panel desync in any order.
- **Simulation numbers:** every §3.1 constant is defined once in `src/sim/tasks.ts:7-17` and used
  nowhere else; no duplicated magic numbers for speed/arrival/timers.
- **Determinism:** no `Math.random`, no clock, no timer inside `src/sim/`; all randomness is
  `mulberry32` or index hashes; `JSON` round-trip and lockstep are covered by tests.
- **Anti-bloat:** exactly three zones in `src/styles/ui.css`; no settings, modal, tooltip layer, or
  fourth panel; `prefers-reduced-motion` is honoured in CSS (`ui.css:162-168`).
- **Performance pillars:** `InstancedMesh` for trees/bushes/rocks/tufts/flowers/ambient, pixel ratio
  `min(dpr, 2)`, 29.1k triangles, fog and shadow bounds consistent with the camera range.

---

## Part B — 20 improvement proposals

Ordered roughly easiest → hardest. Every one folds into the three existing zones (or touches only
the world/audio), per DESIGN §6; all stay inside §2's pillars.

### Easy

**1. [easy] "Stop" button in the task popover.** A fourth button next to Chop/Berries/Rest that
calls `assignTask(id, null)`. It closes the dead-end in I2 — right now a villager can never be made
idle except by finishing a rest — and it is an addition *inside* zone 3, not a new zone.

**2. [easy] Re-clicking the active task cancels instead of resetting.** Make the highlighted task
button act as a toggle (or a guarded no-op, M7) so a stray click never wipes up to 1.4 s of progress
or restarts a rest timer. Costs one `if` and removes a whole class of player confusion.

**3. [easy] Throttle the "good news" feedback.** Cap the HUD pill pulse at ~1 per 600 ms and the
yield SFX at one per ~400 ms with a little pitch variation (fixes I4 and M11). The counts still tick
up instantly — only the *animation and sound* get sparse, which is what §2.4 asks for.

**4. [easy] Show state, not just task, on the villager card.** "Walking…" → "Chop wood" → "Resting",
plus a hairline progress bar on the selected card driven by the existing `progressMs` (zone 2, no
new element). The player finally sees that assignment → travel → work is a sequence.

**5. [easy] Campfire flame flicker + warm point light.** A slow ±6 % scale/emissive breathe on the
flame cone plus one low-intensity warm `PointLight` at the fire (`environment.ts` campfire block).
The fire is currently a static flat cone — the single cheapest change that makes the whole clearing
feel lit rather than rendered.

**6. [easy] Quiet fire crackle + walking texture in audio.** Procedural filtered-noise grains at a
slow random cadence for the fire, and a soft footstep puff when a villager is `walking` (audio
already receives full state every frame, so it can diff transitions itself). Fills the silence
between chirps without adding UI or assets.

**7. [easy] Keyboard 1/2/3 assigns to the selected villager.** No visible change at all (anti-bloat
safe), but it turns task-juggling with eight villagers from eight clicks into one. Esc already
clears selection.

**8. [easy] Honor `prefers-reduced-motion` in the render layer.** The CSS already does
(`ui.css:162`); the 3D layer does not — halve bob/sway amplitude and stop the selection-ring pulse
when the OS asks for it. Accessibility parity with the work T1 already did.

### Medium

**9. [medium] Camera focus on the selected villager.** Double-clicking a card (zone 2) gently dollies
the existing damped orbit toward that villager and back on deselect — using the already-present
`projectVillager`. Solves the real annoyance that selection can land on someone behind a tree or
outside the frame, with zero new UI.

**10. [medium] Make gathering legible in the world.** Berry bushes get a handful of small instanced
`berry`-toned dots; the tree being chopped gets a pale cut-mark that appears on `chop` events.
Resources currently accumulate from invisible work — this is the feedback loop the whole game is
built on, and it is entirely inside existing palette keys.

**11. [medium] Stockpile props that grow with the counters.** A log pile and a berry basket beside
the campfire, one instanced mesh whose count tracks `resources.wood / berries` (capped, say, at 12
stacked units). Turns two abstract HUD numbers into something you can look at — no fourth zone,
because the HUD already shows the exact figures.

**12. [medium] Resting pose instead of standing.** Sitting on the ring with a slower breathing
cycle (and a tiny lean toward the fire) for the `resting` state — the ring exists, the pose does not.
This is where §2.4 ("everything eases") pays off most, since rest is the one state a player watches.

**13. [medium] Idle wander between assignments.** Unassigned villagers stroll slowly (existing
straight-line movement, well under 2.2 u/s) to a fresh spot in the clearing every 6–10 s. Eight
statues around a fire is the emptiest the game ever looks, and wander is the standard fix.

**14. [medium] Acknowledgement when a task is given.** On `assignTask`, the villager turns toward
the camera and does a small hop/arm-raise (render-only reaction to `state` transitions), plus a
soft arrival "settled" puff. Assignment currently answers only as a label change in a side panel.

**15. [medium] Deterministic slots at work nodes.** Golden-angle arrival offsets around the target
tree/bush (I1's fix) so villagers spread out instead of stacking three-deep inside one trunk. Same
determinism trick the rest ring already uses, so it is a small, testable sim change.

**16. [medium] "Recent activity" line replaces the static panel hint.** Zone 2's header text
becomes a rolling one-liner — "Clover rested", "Moss brought 4 wood" — built from events the state
already carries. It is a *replacement* inside an existing zone (explicitly what §6 asks for) and it
gives the village a narrative heartbeat.

### Hard

**17. [hard] Route rest paths around the fire.** A single mid-arc waypoint for `task === 'rest'` so
nobody walks through the flames (I3; two of eight villagers do it today). Needs an orchestrator
ruling because it bends §3.1's straight-line rule — worth it, since a character inside a fire is the
loudest visual bug in the build.

**18. [hard] Cut villager draw calls before the budget bites.** Merge each rig's same-material parts
into one geometry, or at minimum drop `castShadow` on arms/hat/pom (I10: −32 calls now). This is the
performance work that *serves the player*: it buys the headroom that proposals 10–14 will spend.

**19. [hard] Batch assignment from the popover.** An "everyone idle" control inside zone 3 that
assigns all currently-idle villagers to the highlighted task. Eight villagers is already at the
edge of click-by-click management; needs careful design (no confirmation modal — §6 forbids them) so
it stays a single, reversible gesture alongside proposal 1.

**20. [hard] Let resources mean something: the campfire burns wood.** Wood slowly feeds the fire —
flame scale, light radius, and crackle density track a `fuel` value that decays over time — so
chop becomes a purposeful loop rather than an ever-growing number. This is the first real gameplay
depth for slice 2; it touches sim state, so it needs an orchestrator scope ruling (§10 forbids
save/load and day–night, not this) and the HUD keeps showing the same two counters.

---

## Reviewer's note for the orchestrator

Findings I would fix before the human playtest, in order: **I1** (stacking, seen in 30 seconds) →
**I2** (no stop button, felt in 60 seconds) → **I4** (audio clatter) → **I3** (needs a §3.1 ruling,
so decide it deliberately rather than by accident). I5/I6 are one-line insurance. Everything in
Part A is evidence-backed with file:line; nothing in this report was written to fill a quota.
