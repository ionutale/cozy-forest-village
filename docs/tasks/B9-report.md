# B9 — Independent review of batch 2 + 20 improvement proposals

Reviewer: independent subagent (same model that did T07, batch 1). **Read-only** — the only file
touched is this one.

Scope: the batch-2 delta (B1 fire/tend · B2 build/cook/meals/fed/garden · B3 persist · B4 fire
render · B5 structures + picking · B6 poses · B7 UI · B8 audio) plus regressions it introduced in
batch-1 code.

---

## 0. What was run

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm test` | **6 files / 51 tests passed** (228 ms) |
| Live browser (vite :5175, chrome-devtools, page freshly reloaded) | console clean — only `[vite] connecting…/connected` debug lines. (The 1166 `setPointerCapture` errors seen during probing came from *my* synthetic `PointerEvent`s reaching OrbitControls, not from the game; a reload with no synthetic input is clean.) |
| `__cozyRender.info()` | **120 calls / 28 052 tri** default · **142 / 29 160** with all 7 structures built · **145 / 29 768** with 8 cooks at the pot. Budget is <200 calls / 600 k tri → **pass, ~27 % headroom on calls, 20× on triangles**. `geometries ≤ 40`, `textures 2`. |
| Save → reload round trip (live) | all batch-2 fields survive: `fire.fuel`, `pot.meals`, `gardenMs`, `structures[].built`, `villagers[].fedMs/carrying/restMs/progressMs`, `resources`, 7 structures / 61 nodes. `events` starts `[]` (cleared by the first `tick`). |
| Sim probes (run inside the page against `/src/sim/index.ts`) | see each finding; no repo files written. |

Findings: **12 total — 1 Critical, 4 Important, 7 Minor.**

---

# Part A — Findings

## Critical

### C1 — Clicking a villager in the 3D world never opens (and instantly closes) the task popover
`src/ui/index.ts:253-254` · `src/main.ts:80-84`

`applyStructureSelection()` calls `clearSelectionVisuals()` **unconditionally, before** its
`structureId === null` early return. `main.ts` always fires both selectors on every canvas click:

```
main.ts:80  const villagerId = render.pickVillager(...)
main.ts:81  const structureId = villagerId ? null : render.pickStructure(...)
main.ts:83  ui.select(villagerId);          // → openPopover → popover.hidden = false
main.ts:84  ui.selectStructure(structureId);// → applyStructureSelection(null) → hidden = true
```

So a world click on a villager opens the card and closes it again in the same gesture.

**Why it matters:** this is *the* core interaction of the game — pick a villager in the world, give
them a task. It silently degrades to "the selection ring appears but no card", and the only working
path is the side-panel list. It is a batch-2 regression of T05's headline feature, and B7's report
claims `| Click a villager | task grid, structure card hidden |` — that row was evidently produced
with panel clicks, not world clicks.

**Measured** (stack captured by redefining `HTMLElement.prototype.hidden` during a world click on
`v4`):

```
hidden=false ← openPopover ← applySelection ← Object.select ← main.ts (pointerup)
hidden=true  ← clearSelectionVisuals ← applyStructureSelection ← Object.selectStructure ← main.ts
```

and directly: after a world click the popover title becomes the villager's name, then
`popover.hidden === true`, `.villager-card.selected === 0`. A panel click on the same villager
leaves `hidden === false`, `selected === 1`.

**Minimal fix** (2 lines): in `applyStructureSelection`, return before clearing when there is
nothing to clear —

```ts
function applyStructureSelection(structureId: string | null, state: GameState): void {
  if (structureId === null) { selectedStructureId = null; return; } // main.ts already routed ui.select()
  clearSelectionVisuals();
  ...
```

`select(null)` still handles "empty ground clears both" (`main.ts:83` runs first), so no behaviour
is lost. Re-verify: world-click villager → grid opens; world-click ghost → structure card; ground →
both cleared.

---

## Important

### I1 — The `built` event is emitted outside `tick()`, so every consumer misses it — B8's "built" SFX can never play
`src/sim/index.ts:116` vs `:122` · `src/main.ts:99-102` · consumer `src/audio/index.ts:317`

`buildStructure()` pushes `{type:'built'}` into `state.events` from a click handler (outside the
frame). The next frame starts with `tick()`, whose first act is `state.events = []`. The frame order
is `tick → render.render → audio.update → ui.render`, so `audio.update` — the *only* runtime
consumer of `'built'` (verified by grep: `audio/index.ts:317`, everything else is a test) — always
sees an already-cleared array.

**Measured live:** click Build → immediately `state.events === [{"type":"built","structureId":"garden"}]`,
`wood 100 → 75`, `built = true` → one frame later `state.events === []`.

**Why it matters:** B8's "it's yours now" knock+chime (`builtSfx`) is dead code in the running game,
and B2's `built` event is unobservable by design-of-accident. Unit tests pass because they read
events right after the call, which no real consumer ever does. Any future consumer (a flash, a
journal line) will hit the same wall.

**Minimal fix:** give `buildStructure` a pending-events queue flushed at the top of `tick()`
(`state.events = [...pending]; pending = []`), *or* push from `main.ts`'s build action after
checking the return value (`if (buildStructure(...)) state.events.push(...)` still loses it — so
the queue/flush is the honest fix). One-line variant: have `tick()` **append** to a second
"out-of-band" list merged into `events` instead of wiping it.

### I2 — A log picked up by a keeper is stranded forever if the keeper is reassigned (wood leak + permanent carry pose)
`src/sim/index.ts:62-102` (assignTask never touches `carrying`) · `src/sim/index.ts:283-292`
(deposit only under `task === 'tend'`) · `src/render/villagers.ts:326-329` (pose keys on
`villager.carrying` alone)

The keeper loop is gated on `villager.task === 'tend'`, but `carrying` is a free-standing field.
Reassign a mid-carry keeper to anything else (or Stop) and the log in hand is never deposited and
never refunded; `pose()` keeps raising the arms and drawing `log` (B6 says it "vanishes on deposit").

**Measured live:** assign Tend (wood 6 → 5, `carrying: true`) → click *Chop wood* → after 6 s
`task:'chop', carrying:true` while chopping (wood 5 → 17 from chumps) → click *Stop* →
`task:null, state:'idle', carrying:true`. Reproduced in the pure sim too.

**Why it matters:** (a) one wood is invisible in the economy until/unless Tend is re-assigned;
(b) an idle or chopping villager renders the carry pose forever — a stuck animation state that reads
as a bug; (c) §3.2's keeper loop is effectively only half-defined outside `tend`.

**Minimal fix:** in `assignTask`, when the resolved task is not `'tend'` (or is `null`) and
`villager.carrying`, settle the hand first:

```ts
if (villager.carrying && task !== 'tend') { villager.carrying = false; state.resources.wood += 1; }
```

(Free refund keeps the ledger honest; alternatively route them to the campfire to deposit, which is
nicer but more code.)

### I3 — Keeper and cook legs walk straight through the flames (§3.2's stated invariant, measured)
`src/sim/index.ts:252-260` — only `CAMPFIRE_ID` targets get the approach arc; every other target is
`arrival = center` on a straight chord.

§3.2: *"…the **rest approach arc**, exactly like `rest` — keepers never walk through or stand in
the flames."* The deposit and stand-watch legs do arc (B1's own test covers them), but the **outbound
woodpile leg** does not, and neither does the cook's walk to the pot.

**Measured** (min distance from the fire centre while `state === 'walking'`, spawn → target, 8
villagers, fresh state):

| leg | min distance per villager | verdict |
|---|---|---|
| tend → woodpile | 1.97, 2.80, 2.70, 2.54, 2.03, **0.86**, **0.09**, **1.13** | 3 of 8 inside 1.1; v7 passes **0.09 u from the centre** |
| cook → pot | 2.40, 4.17, 2.67, 2.18, **0.82**, **0.88**, 2.02, 2.64 | 2 of 8 stand *in* the fire pit |
| chop / berries | ≥ 2.40 | fine (nearest-node choice keeps them on their side) |

**Why it matters:** a keeper visibly strolling through the campfire flames is the exact moment the
"cozy, gentle" pillar breaks, and it is the batch-2 headline feature. T07 flagged the same class of
bug for `rest` (I3) and it was fixed there; the new legs were not.

**Minimal fix:** in `walk()`, for non-campfire targets compute the perpendicular distance of the
chord `villager.pos → arrival` from the campfire; if `< 1.1`, steer to the `r = 2.2` bisector point
first (reuse `REST_ARC_RADIUS` / `signedAngDiff`, ~10 lines). Keeps determinism and §3.1 untouched.

### I4 — Cook channel deducts per iteration but checks affordability only once → negative resources on a large `dt`
`src/sim/index.ts:306-321`

```ts
if (berries < 3 || wood < 1) { …idle…; return; }
villager.progressMs += dtMs;
while (villager.progressMs >= COOK_CHANNEL_MS) { …berries -= 3; wood -= 1; meals += 1; … }
```

One gate, N deductions. §3.1 guards **only** non-finite `dtMs`; nothing clamps magnitude.

**Measured:** fresh state, pot built, `berries 3 / wood 1`, villager standing at the pot, then a
single `tick(state, 60000)`:

```
before: [working, berries 3,  wood 1, meals 0]
after : [working, berries −57, wood −19, meals 20]   (+20 `meal-cooked` events)
```

**Why it matters:** not reachable from today's frame loop only because `main.ts:97` happens to clamp
`dt` to 100 ms — a clamp that is not part of the sim contract. Any fast-forward, tab-restore
strategy, test, or future "skip ahead" feature corrupts the ledger and the HUD happily renders
negative berries. It also leaves the cook `working` instead of idling when ingredients run out.

**Minimal fix:** move the affordability check inside the loop —

```ts
while (villager.progressMs >= COOK_CHANNEL_MS) {
  if (state.resources.berries < COOK_BERRIES || state.resources.wood < COOK_WOOD) { …idle…; return; }
  villager.progressMs -= COOK_CHANNEL_MS; …
}
```

(or cap `progressMs` at `COOK_CHANNEL_MS - 1` after each cook). Same one-line shape already used by
the garden's `while (gardenMs >= period)` which is safe because it only ever *adds*.

---

## Minor

### M1 — The structure card rewrites its cost line (`innerHTML` + SVG parse) every frame
`src/ui/index.ts:217` written from `:426` (`if (selectedStructureId) syncStructureCard(state)`)

**Measured:** with an unbuilt structure selected, `.structure-cost.innerHTML` was assigned
**118 times in 2 000 ms** (≈2/frame), each parsing 1–2 inline SVGs. Harmless at one card, but it is
pure per-frame DOM churn while a ghost card is open — the exact shape of §6's "no creep" perf
anti-goal. Same call also re-sets `aria-disabled`, `hidden` and text nodes 60×/s.

**Fix:** cache the last rendered signature (`kind|built|wood|berries|pot.meals`) in a local and
return early when unchanged; hoist the `must<HTMLElement>` pill lookups at `:388` out of the loop.

### M2 — A stand-watch keeper animates the **chop** swing in mid-air
`src/render/villagers.ts:298-316` — `case 'working'` branches only on `cook` and `berries`; every
other task (`tend`) falls into the chop pulse (`LEAN_CHOP 0.19`, arm swing 2.2 Hz).

Keepers spend most of their life in stand-watch (that is the design), so several villagers are
perpetually leaning and swinging at nothing, labelled "Tending fire". **Fix:** add a `tend` branch —
near-neutral pose with a slow 0.6 Hz sway and a small forward arm (poking the fire), or simply fall
through to the `resting` breathing pose. No new geometry.

### M3 — No arrival slot for structure targets: 8 cooks end up stacked on one spot
`src/sim/index.ts:256-260` (`arrival = center` for anything that is not chop/berries)
§3.1's per-villager slot (`workSpot`) covers nodes only; §3.2 says targets "resolve by kind …
through the same `targetNodeId`" but says nothing about slots.

**Measured:** all 8 villagers assigned Cook → all `working`, distance to the pot centre
`0.41 … 0.45`, **minimum pairwise separation 0.00** (two villagers at identical coordinates).
Same crowd forms at the woodpile when several keepers fetch together. **Fix:** reuse
`workSpot(structure.pos, villagerIndex)` (r = 0.75) for `TASK_STRUCTURE` targets in `walk()` —
5 lines, mirrors the existing idiom.

### M4 — `loadGame` accepts plausible-but-empty shapes → NaN fuel and villagers that rest forever
`src/persist/index.ts:26-35` (`isPlausibleState` checks only "is an array / is an object")

**Measured:**
* `{villagers:[], nodes:[], structures:[], fire:{}, pot:{}}` with `version:1` → **loads**; after one
  `tick`, `fire.fuel === NaN` and the HUD renders **"Fire NaN"** (render is saved only by
  `resolveFire`'s `!(f.max>0)` guard at `environment.ts:36`).
* A villager record with `restMs`/`fedMs`/`carrying` deleted → loads, then stays `state:'resting'`
  **forever** (`sim/index.ts:342`: `progressMs >= undefined` is always false).

B3's brief asked for exactly this shallow check, so this is a spec-compliant gap rather than a
B3 bug — but it is one `VERSION` bump away from being user-visible (a future schema written as v1).
**Fix:** in `isPlausibleState`, also require `fire.fuel`/`fire.max`/`gardenMs` to be numbers and
every villager to carry `restMs`, `fedMs`, `carrying`, `task`, `state`; otherwise `null`.

### M5 — Stale comments and dead fallbacks left behind by the delta
* `src/main.ts:123-124` — "Slice 1 has no save system, so there is nothing to restore" — false since
  B3; the `pageshow → reload` branch now silently discards up to 3 s of unsaved progress on a bfcache
  restore.
* `src/render/environment.ts:7-9` — the `Environment` doc still says "render/index.ts still calls
  `update(timeSec)`", but `render/index.ts:139` always passes `state.fire`.
* `src/render/environment.ts:33-39` — the `window.__cozy` hook fallback inside `resolveFire` is now
  unreachable (dead branch, but it is the only place the render layer reaches into global state).
* `src/sim/tasks.ts:33-34` — `restDuration` doc says "Evaluated against the live fire **each tick**";
  §3.2 (and the code) evaluate it **once, at rest start** — the comment contradicts the contract.

### M6 — UI duplicates the sim's build-cost table
`src/ui/index.ts:65-72` vs `src/sim/tasks.ts:58-65`. Documented and currently correct, but the
contract ("other layers import **types** from `../sim` and nothing else") makes drift undetectable —
`tsc` will never complain when §3.2 costs change. **Fix:** export a `readonly` `STRUCTURE_COST`
alongside the types (it is data, not internals) and have the UI import it; that also removes the
comment at `:62-64`.

### M7 — Eating has no "already well-fed" guard
`src/sim/index.ts:274-278` — arrival at `fuel ≥ 33 && meals > 0` always consumes a meal and resets
`fedMs = 60000`, even when the villager has 55 s of buff left. Repeatedly clicking **Rest** on one
villager drains the pot (3 berries + 1 wood per meal) for zero benefit, and each re-assignment also
re-eats on arrival. **Fix:** `if (state.pot.meals > 0 && villager.fedMs < 60000)` — or top up only
when `fedMs < 30000`.

---

### Contract scorecard (§3 / §3.2, letter)

| Rule | Verdict |
|---|---|
| Types / signatures: `TaskId`, `Villager`, `SimEvent`, `GameState`, `createInitialState`, `assignTask`, `buildStructure`, `tick`, `RenderHandle.pickStructure`, `UIActions.build/resetVillage`, `UIHandle.selectStructure` | ✅ exact |
| Layers import **types only** from `../sim` | ✅ (except `main.ts`, which is the entry) |
| speed 2.2 · arrival 0.45 · work 1400 · rest ring 1.6 / golden angle · arc r 2.2 / 0.25 · rest 4000 | ✅ |
| non-finite `dt` → 0 · events cleared at tick start · deterministic (no `Math.random`/clocks in `sim/`) · `facing = atan2(dx,dz)` | ✅ |
| fire 70 start · 0.22/s · floor 0 · log +25 cap 100 · states ≥66/≥33/>0/=0 · tend fetch `fuel ≤ 75`, `wood ≥ 1` | ✅ |
| rest duration 4000/5500/7000 at rest start · eat at `fuel ≥33` + `meals > 0` → −1 meal, 5500 ms, `fedMs 60000`, `eat` · work 1190 while fed · `fedMs` decays every state | ✅ |
| cook: pot required, 3000 ms, 3 berries + 1 wood, loops, → idle when dry | ✅ (see **I4** for the large-`dt` hole) |
| build costs 20/15/25/10/10+5, `built`, `built` event, false on unknown/again/unaffordable, never partial | ✅ code · ❌ event never observable (**I1**) |
| garden +1 berry / 30 000 ms while built · `gardenMs` in state | ✅ |
| structure ring r 5.2 @ 30°…330°, ids, woodpile pre-built @90° r 2.6 · world scatter from r 7.5 | ✅ |
| keepers "never walk through or stand in the flames" | ❌ outbound leg measured at 0.09 u (**I3**) |
| §6: exactly 3 zones · fuel pill + mini bar · 2×3 grid · structure cards in the popover · two-step reset, no modal | ✅ verified in DOM (`#hud`, `#villager-panel`, `#task-popover`) |
| §2: tokens.css matches §4 exactly · palette adds only `ember`/`soil`/`cauldron` (B4/B5-sanctioned) · ambient 3 species · gentle easing everywhere | ✅ |
| perf: <200 draw calls, ≤2 as pixel ratio, instanced forest | ✅ 120–145 calls, 28–30 k tri |

---

# Part B — 20 improvement proposals for the player

Each respects §2 (gentle, cohesive, cozy) and §6 (fold into an existing zone — **no fourth zone**).

1. **[easy] Give keepers a watch pose.** `pose()` should branch on `task === 'tend'`: a slow 0.6 Hz
   sway with one arm held forward (poking the fire) instead of the chop pulse (M2). Three lines in
   `render/villagers.ts`, and the most-looked-at villagers stop air-chopping.
2. **[easy] Route every leg around the flames.** Extend the rest approach arc to any target whose
   straight chord passes within ~1.1 of the fire (tend-outbound and cook today, measured 0.09–0.88 u)
   (I3). Nothing about speed or arrival changes — only the steering point on the r = 2.2 ring.
3. **[easy] Reuse `workSpot` for structure arrivals.** Cooks and keepers get a per-villager slot
   around the pot/woodpile so eight cooks stop standing inside each other (M3). It is the same
   golden-angle idiom already used for trees and rest, so it will feel identical.
4. **[easy] Let the `built` event reach the audio layer.** Flush events queued outside `tick()` at
   the start of the next tick (I1) so the "it's yours now" knock + chime finally plays on Build.
   Zero visible UI, one earned moment of feedback for a 20-wood decision.
5. **[easy] Pulse the fuel pill when a log lands.** Re-fire the existing `yield-pulse` animation on
   `[data-res="fuel"]` for `fuel-add` events (zone 1, no new element). The +25 jump currently only
   shows as a number change; a soft pulse makes the keeper's effort legible across the clearing.
6. **[easy] Well-fed badge on the villager card.** While `fedMs > 0`, tint the card's `.task-label`
   with `var(--leaf)` (zone 2, same mechanism as `.selected`). It quietly explains why that villager
   is working faster, without a tooltip, counter or new element.
7. **[easy] Don't burn a meal on a full belly.** Skip the eat (and the `eat` event) when
   `fedMs ≥ 60000`, or only top up below 30 s (M7). Protects a 3-berry + 1-wood asset from Rest
   spam and makes the first meal of a session feel deliberate.
8. **[easy] Teach the cook loop where the player already looks.** In the pot's built status line
   (zone 3) show `Meals: N · 3 berries + 1 wood each` instead of a bare `Meals: N`. One text node
   that already re-renders every frame.
9. **[medium] Garden countdown instead of "Growing…".** Use `gardenMs` (already in state) to show
   `Growing… 18s` in the same status line — the card syncs per frame anyway, so it is free and it
   turns a passive 25-wood purchase into something to watch.
10. **[medium] Show meals past six at the pot.** The bowl stack caps at `min(meals, 6)`
    (`structures.ts:197`), so a stocked pot looks identical to a half-full one. Scale the top bowl
    slightly with `meals` above 6, or let the steam get denser — a status cue, not a counter.
11. **[medium] A warmth disc that breathes with fuel.** A soft translucent disc (opacity ≈ 0.06–0.1,
    radius following `fuel/max`) under the existing clearing disc, easing with the same two-sine
    flicker as the flame. It makes the ≥33 "someone can eat here" radius readable without a number.
12. **[medium] Cursor + gentle hover cue for pickables.** Raycast on `pointermove` (throttled to
    ~10 Hz) and set `cursor: pointer` when a villager or structure is under the pointer. Nothing
    appears or disappears visually — it just stops players hunting for what is clickable, which is
    today's biggest discoverability gap after C1.
13. **[medium] Wind gusts on the existing bed.** Modulate the wind gain with a slow (0.02–0.05 Hz)
    noise envelope so the forest breathes instead of droning at constant level. One LFO on an
    existing node, no new voices, stays inside the "gentle, never loud" audio rule.
14. **[medium] Cook blips that climb with a streak.** Nudge `mealBlip` pitch up ~1 semitone per
    consecutive meal (bounded, reset on idle) and ease back down. It turns a cooking run into a
    tiny rising phrase while reusing the exact same two oscillators.
15. **[medium] Make the garden audible.** Fire the (throttled) gather pluck when `garden` yields a
    berry — the sim already emits `gather`-class events, so it is a one-case addition to the audio
    switch with the 400 ms per-type cooldown. A quiet "something grew" without any UI change.
16. **[medium] Cheaper `ui.render`.** Cache the pill elements and the structure-card signature and
    skip the `innerHTML` rewrite when nothing changed (M1); hoist `querySelector` out of the frame.
    Measured 118 SVG parses/second today — this buys back real frame budget for §2's motion.
17. **[hard] Merge/instance structure parts.** Batch the seven structures' shared geometries into
    per-kind `InstancedMesh`/merged draws to bring 142–145 calls down to ~80, leaving headroom for
    the next batch. Pure perf, invisible to the player, and it is the one budget line (calls) that is
    only 27 % from the ceiling.
18. **[hard] Deterministic obstacle-aware walking.** Replace the straight chord with a 1–2 waypoint
    route around the fire and dense tree clusters (precomputed per leg from the seeded world, so
    determinism holds). Fixes flame-crossing *and* villagers clipping trunks — the last visible
    "gamey" tell in an otherwise gentle world.
19. **[hard] Save schema v2 with migrations.** Bump `VERSION`, add per-field defaults and a
    migration shim so a partial or future-shaped save can never produce `Fire NaN` or a villager who
    rests forever (M4), while still loading today's v1 files. Keeps batch 2's saves alive as the
    state grows.
20. **[hard] A rotating village line in the panel hint.** Replace `.panel-hint`'s static copy with a
    slow, throttled one-liner drawn from state ("The fire is dimming", "Clover is well-fed", "The
    garden is ready") — zone 2 text that already exists, no new panel, no modal, and it teaches the
    game's systems in the game's own voice. Needs a small copy table and a 20 s cadence so it never
    chatters.

---

## Appendix — verified as correct (so the orchestrator need not re-check)

* **Resource accounting:** cook 3 berries + 1 wood per meal (loop-correct at normal `dt`), build costs
  exactly once and never partially (`food.test.ts` + my re-runs), garden +1/30 s only while built,
  tend −1 wood per log / +25 fuel per deposit / cap 100, chop/berries +1 per 1400 ms (1190 fed).
  **8 keepers competing for 1 wood never drive it negative** (min observed 0) — the check-and-take
  happen inside one villager's iteration, so no interleaving window exists.
* **Fire/rest/fed:** decay floors at 0; rest duration committed at arrival; `eat` only at
  `fuel ≥ 33 && meals > 0`; `fedMs` decays before the state switch so an eat this tick survives;
  work period reverts to 1400 ms at `fedMs = 0`. Long-run economy probe (2 keepers + 1 chopper,
  20 min simulated): fire stayed ≥ 68.9 with a live chopper — no death spiral, embers stay
  non-fatal.
* **Save/load:** full round trip incl. every batch-2 field, live-verified across a real reload;
  `events` never leak across a reload (first `tick` clears before anything reads).
* **Edge cases with fuel 0 / wood 0 / meals 0 / unaffordable / cook without pot** are all covered by
  `fire.test.ts`, `food.test.ts`, `behavior.test.ts` and behave per §3.2 (stand-watch, no eat, no
  spend, idle on unbuilt pot).
* **Determinism / purity:** no `Math.random` or clocks in `sim/`; identical seeds deep-equal after
  scripted play; render/audio each own a seeded PRNG.
* **§6 anti-bloat:** exactly `#hud`, `#villager-panel`, `#task-popover`; fuel pill, 2×3 grid,
  structure card and ⟲ reset are all inside them; `tokens.css` matches §4 to the letter.
