# T4 — Render + audio: the trader

Batch 7 (traders → spices), task T4. Render body + picking + two audio cues.

## Files changed

| File | Change |
|---|---|
| `src/render/trader.ts` | **new** — `createTrader(): TraderLayer` |
| `src/render/index.ts` | `pickTrader` / `setTraderSelected` on `RenderHandle`; lazy layer, per-frame `update`, `setSelected` re-apply, trader in `pickHover`, `dispose` |
| `src/main.ts` | click chain villager → trader → structure → ground; `render.setTraderSelected` + `ui.selectTrader()`; `onSelect` clears the trader ring; new `trade` UI action → `sim.trade` |
| `src/audio/index.ts` | `visitor-arrive` cart bell + `trade` clink; priority table renumbered 12…1 |
| `docs/tasks/T4-traders-render-report.md` | this report |

## Step 1 — `src/render/trader.ts`

**Rig from the shared kit.** `createRigKit(track)` (the same one `villagers/index.ts` uses) supplies
the torso/head/hat/pom/arm geometries and the skin material, so the trader reads as the same
species at play distance (DESIGN §2 pillar 2). Two colours are the trader's own: a muted blue coat
`#6f8fb0` (tunic material swapped) and a plum hat `#8a6fae` via `kit.hatMaterials(HAT)`. Torso and
head are the only shadow casters, matching the M10 budget in `rig.ts`.

**Handcart prop** — a child of the trader's `root`, so it inherits the yaw and needs no position
state of its own: painted bed + side rails, an axle, two wheels (axis x), two shafts reaching forward
to the trader's hands, a crate and a cloth bundle. A trailing cart that turns when its puller turns.

**Position purely from `(phase, visitMs)`.** `stepAt(visitMs)` fills a module-scope `Step` scratch
(nothing allocated) and is the single source of every positional number:

| `visitMs` | leg | `p` (0 edge → 1 stall) |
|---|---|---|
| `[0, TRADER_WALK_MS)` | walk in, smoothstepped | `u` |
| `[TRADER_WALK_MS, VISIT_STAY_MS − TRADER_WALK_MS)` | linger | `1` |
| `[stay − WALK, stay)` | walk out, smoothstepped | `1 − u` |

Position is `lerp(EDGE, STALL, p)`. **Facing is derived too**, not eased: a fixed yaw per leg, with
the turn toward the campfire riding the last 45 % of the walk in and the first 45 % of the walk out.
No turn smoothing state at all, which is what makes a mid-visit reload land the trader in exactly
the same pose (Review Focus 1). `WALK_IN_MS` / `LEAVE_AT_MS` are floored so a short stay degenerates
safely instead of dividing by zero, and a non-finite `visitMs` falls back to the edge.

**Slow deterministic linger sway** — a fixed-frequency sine off the render clock (`SWAY_HZ = 0.28`,
±0.012 u bob, ±0.018 rad roll, a slightly detuned head), blended with a fixed per-trader offset from
`hash01` so it never lands in step with a villager. No RNG, no `Math.random`, no per-object clock.

**Walk gait** — same cadence family as the villagers (1.2 Hz step, ±0.5 arm swing, 0.06 lean). The
right arm stays pitched back toward the shafts while walking and eases forward when parked. Wheel roll
is `PATH_LEN × p / WHEEL_R` — **derived from the path parameter, never accumulated**, so it is exact
after a reload and frame-rate independent.

**Hidden while away** — `group.visible = false` and an early return; `pick()` gates on
`group.visible` because three's `Raycaster` ignores `visible` (the same trap `structures.ts` handles
with its `shown()` walk).

**Selection ring reuse** — `createSelectionRing(track, group)` from `villagers/ring.ts`: the same
soft two-tone ring the villagers use, in its own group under `group` so it does not inherit the
yaw. `ring.ts` keeps `RING_Y` and its 1.2 s breath private, so the trader mirrors those two numbers
with a comment pointing at the source.

**Zero per-frame allocations** — the `Step` scratch, no closures in the loop, no arrays/objects
constructed or returned by value, no `new` inside `update`/`pick`.

## Step 2 — picking + click chain

`src/render/index.ts` gains `pickTrader(clientX, clientY): boolean` and `setTraderSelected(on: boolean)`
on `RenderHandle` (DESIGN §3). `traderSelected` is parked next to `selectedId`/`selectedStructureId` so
the ring survives lazy layer creation, and `trader.setSelected(traderSelected)` is re-applied every
frame for the same reason the other two cues are. `pickHover` gained the trader between the villager
and the structure, short-circuiting in the same order as the click chain.

`src/main.ts`:

```
villagerId  = pickVillager(...)
traderPicked = villagerId ? false : pickTrader(...)
structureId = villagerId || traderPicked ? null : pickStructure(...)
render.setSelected / setSelectedStructure / setTraderSelected / focusVillager
ui.select / ui.selectStructure; if (traderPicked) ui.selectTrader()
```

T3's `selectTrader()` takes no argument — the trader face opens on the call and every other
selection path closes it inside the UI — so main.ts calls it only on a trader hit and relies on the
`select(null)` / `selectStructure(null)` calls above it for the close. `onSelect` (panel-driven card
click / Escape / outside click) also calls `render.setTraderSelected(false)`, so the ring cannot
linger under a card that is no longer open.

## Step 3 — audio

- `visitor-arrive` → `cartBell()`: a soft two-note cart bell, G5 (784) → C6 (1046.5), with a quiet
  G6 partial under the strike so it reads as metal rather than as another chime. Pitched clear of
  `favor-done` (523/784) and `rest-done` (660/880), quieter than `built` which outranks it.
- `trade` → `tradeClink()`: one tiny bright clink (2637 → 2349 Hz) plus a quieter sparkle. Both trade
  kinds share it — the popover already names which happened — so the shared ~400 ms cooldown is also
  what keeps three trades in one tick from stacking.

Priority table renumbered with the relative order preserved exactly as specified:
`built 12 > favor-done 11 > meal-cooked 10 > rest-done 9 > visitor-arrive 8 > favor-start 7 >
trade 6 > eat 5 > fuel-add 4 > garden 3 > gather 2 > chop 1`.
`visitor-leave` and `arrived` stay silent. Lazy start, per-type cooldown, wind gusts, cook streak,
crackle and dispose are untouched.

**The cart turns with the trader at the stall.** The trader's yaw swings π between the two legs, and
a cart pinned at local −z would be carried *around through the trader* by that sweep and left walking
backwards. `cart.rotation.y` is therefore derived from the same `turn` scalar: 0 on the way in and
while lingering, and `(FIRE_FACING − facing) + π · turn` on the way out, with the rotation order set
to `'YXZ'` so the yaw is applied before the walk pitch. Both yaws therefore move together and the
cart ends up behind them again, facing the way they walk. Wheel roll uses `leg` (0→1 along the
current leg) rather than `p`, so both legs roll *forward*; the reset between legs is invisible
because the wheels are unspoked cylinders.

## Fix round 1 — the trader was never in the scene (Critical)

The live pass found the trader absent from the frame and unpickable. Cause: `createTrader()` built
`root`, parented `body` and `cart` into it, tagged its meshes with `userData.trader = true` — and
never did `group.add(root)`. The layer group therefore held only the selection ring, so `update()`
moved a `root` that was not in the graph and `pick()` raycast only ring meshes (all untagged), which
is why clicks at the projected stall pixel fell through to the ground and the trade popover could
never open. `tsc`, `build` and the suite were all green throughout: nothing in the type system can
see an object-graph omission, and no unit test covers this layer.

Fix: one line, `group.add(root)`, placed after the rig and the cart are fully assembled and
immediately before the `root.traverse` tagging pass. Re-checked after the fix — `update()` moves and
yaws `root` (and `group.visible = false` now genuinely hides the body while away, which it could not
before); `group.children` is `[ringGroup, root]`, so `pick()`'s `intersectObjects(..., true)` recurses
into `root`'s tagged subtree and skips the untagged ring, matching the villager layer's behaviour; and
`dispose()` is unaffected — `group.clear()` drops both children, geometries and materials still ride
`disposables` + `kit.clearCache()`, and `disposeScene` in `render/index.ts` runs afterwards so the
newly-connected subtree is disposed exactly once.

Lesson for the wave: a render layer needs a scene-graph assertion, not just a type check. The cheapest
guard would have been one line in the orchestrator's live pass — count `group.children`, or project
the stall pixel and assert a hit — and that check is now worth keeping in every subsequent render task.

## Verification (final, all three green)

- `pnpm exec tsc --noEmit` — clean.
- `pnpm build` — clean (`tsc --noEmit` + `vite build`, 36 modules, 649 kB / 168 kB gzip).
- `pnpm test` — **254/254 passed, 12/12 files.**

Earlier in the task the gate was red only in concurrent agents' files (`src/persist/index.test.ts`
still asserting `VERSION = 3` and a 2-key `resources`; `src/ui/structure-card.test.ts` fixtures missing
`spices`); both cleared once T2 and T3 landed. Nothing in my four files was ever red.

## Notes for the orchestrator

- **Stall placement is a render-layer choice**, not a binding number: r = 4.2 at 300°, the gap between
  the feeder (270°) and the pot (330°), ≈ 2.6 u clear of both and outside the campfire's r = 2.2
  approach arc. Spec says "the south edge"; `EDGE_SPAWN` is `(0, −12)` and huts use it, so the trader
  enters from the same forest edge for visual continuity. The spec's and the huts' south-edge wording
  differ; I matched `EDGE_SPAWN`. Flip `EDGE_X`/`EDGE_Z` if the live pass wants the camera-near side.
- **Live pass should check**: walk-in leg (~6 s, no snapping at either end), the stall turnaround
  (the cart must end up *behind* the trader again, wheels still rolling forward), the linger stall not
  intersecting a structure, the ring tracking the trader's body (not the cart), and that clicking the
  cart — not just the trader — selects them.
- The trader layer builds its own `RigKit` rather than sharing the villagers' — one extra set of
  geometries and three materials, negligible, and it keeps `dispose()` self-contained.