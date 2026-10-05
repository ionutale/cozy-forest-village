# H4 — Render: hut model + ghost, rig-growth verify

Wave: huts → newcomers (batch 6). Files: `src/render/structures.ts`, plus one additive line in
`src/render/selectionCue.ts` (justified below). `src/render/villagers/index.ts` **unchanged** — see
Step 1. No tests written: this layer has none, and the plan's Step 3 defers it to the orchestrator's
live pass.

## Step 1 — Verify rig growth (no edit needed)

Result: **no length-of-8 assumption exists anywhere in the villager layer.** Evidence:

- `src/render/villagers/index.ts:71-81` — rigs are created lazily per villager, keyed by id
  (`rigs.get(villager.id)` → `createRig`), so a ninth, tenth, eleventh or twelfth villager costs one
  rig and nothing else. The loop is `state.villagers.forEach`, not a fixed count.
- `src/render/villagers/rig.ts:173` — the only per-index value is `phase: hash01(index, 71) * TAU`.
  It is a pure hash of the index, so index 8–11 land somewhere deterministic with no special case and
  no collision with the existing eight (the hash is over the raw index, not `index % 8`).
- `kit.hatMaterials(hatColor)` caches one material pair per distinct hat colour
  (`rig.ts:83-92`), so the four newcomer colours add four pairs and reuse forever after. Nothing is
  indexed by villager index, and the newcomer hexes are distinct from the frozen eight, so no hat
  tint collides.
- `hearts.ts` — the 4-sprite pool is per *burst*, not per villager; `heartSlot` recycles the oldest
  when full, so more simultaneous eaters mean shorter heart life, never a crash or a leak.
- `motion.ts:50-108` — `pose` switches on `villager.state` with an `idle`/`default` arm, so the new
  `'arriving'` state compiles and animates without a case (see Concerns).

So `villagers/index.ts` was left byte-identical, per the plan's "fix only that if found".

## Step 2 — The hut model

Added `case 'hut'` to `chunksFor` (`structures.ts:342-368`). Four parts, one `solid` chunk:

| Part | Geometry | Colour | Notes |
|---|---|---|---|
| pad | `BoxGeometry(1.16, 0.1, 1.16)` | `PALETTE.soil` | earth pad; also the model's widest footprint (half-width 0.58) |
| walls | `BoxGeometry(1.0, 0.6, 1.0)` | `PALETTE.trunk` | sits on the pad, top at y = 0.70 |
| roof | `CylinderGeometry(0.68, 0.68, 1.16, 3)` | `PALETTE.foliageA` | a triangular prism, see below |
| door | `BoxGeometry(0.3, 0.4, 0.06)` | `PALETTE.cauldron` | on the +z face, sunk 0.02 into the wall |

**Why a 3-segment cylinder for a gable roof.** A prism is the only primitive that is a *closed*
gable in one piece: with the cylinder laid on its side (`rot: [-π/2, 0, 0]`) the apex stands up, the
ridge runs along z, and the two triangular caps become the gable ends — no separate triangle fill,
no open underside showing through. Verified numerically (bounding boxes after the exact
`bake` compose): roof x ∈ [-0.589, 0.589], y ∈ [0.68, 1.067], z ∈ [-0.58, 0.58], 22 vertices.

The section an untuned prism gives is *equilateral* — a 60° pitch, far too steep for a cottage.
Three hoisted constants squash and place it instead of burying magic numbers in the part list
(`structures.ts:60-68`):

- `HUT_ROOF_R = 0.68` — the section spans x ± 0.866 r = ±0.589, so the eaves overhang the 1.0-wide
  walls by 0.089 each side.
- `HUT_ROOF_FLAT = 0.38` — a non-uniform scale on the section, taking the pitch to ≈33°.
- `HUT_ROOF_Y = 0.809` — puts the eave line at y = 0.68, i.e. 0.02 *inside* the 0.70 wall top, so no
  hairline gap opens at the eaves. Intersecting solids, no coplanar faces.

Orientation follows `faceFire`, which turns every model's +z toward the campfire, so **all four huts
face the fire with their doors**, and the +z gable end is the wall a newcomer walks up to. The door
is one villager wide (0.3 against a 0.3-wide body) and 0.4 tall, sitting on the pad; the hut stands
1.067 to the ridge against a 0.97 villager — a small cabin, not a hall. `STRUCTURE_SLOT_RADIUS`
is 0.9 and the hut's half-diagonal is 0.82, so a settled newcomer stops just outside the corner
rather than inside the walls.

Palette: **no new key.** `soil` / `trunk` (the "trunk/soil tones" body), `foliageA` (the
"foliage-adjacent hue" roof) and `cauldron` (the dark door panel) all exist.

### Constraints

- **Draw cost ≤ 2 per hut: 1.** One `solid` chunk means one merged mesh for the built model and one
  mesh for the ghost, and the two are never both visible (`update` toggles `root.visible` on
  `built`/`!built`). No `lamp` slot, so no new point light — the budget stays at its existing 3.
- **Ghost shares the built geometry.** `chunksOf` bakes once per kind and both `buildModel` calls
  read the same `Chunk.geo`; the ghost picks `ghostMat` and `castShadow = false` by the existing
  path. Unchanged code, exactly as the woodpile already works.
- **Deterministic / zero per-frame allocation.** All four geometries are built once inside
  `chunksFor` and disposed by `chunksOf` after the bake clone; nothing hut-specific runs in
  `update` (no bowl/steam/sprout branch fires for `'hut'`), so a hut is a pair of static transforms.
- **Indexed geometry only.** `bake` calls `mergeGeometries`, which returns `null` — and this layer
  then bakes an *empty* buffer — if the pieces disagree on indexed-ness. `ExtrudeGeometry`, the
  obvious way to spell a gable, is non-indexed and would have silently produced an invisible hut.
  `CylinderGeometry` is indexed, so the merge is safe.

### One out-of-scope line, and why

`src/render/selectionCue.ts:34` — added `hut: 0.66` to `FOOTPRINT`. That table is a total
`Record<StructureKind, number>`, so H1's `'hut'` member breaks `tsc` without it, and at runtime
`FOOTPRINT['hut']` would be `undefined` → `NaN` on the cue's scale the first time a hut is selected.
The value is the model's own 0.58 half-extent plus air, which is what the table's own comment says
the column holds. One additive key, no other change to that file; no concurrent task in this wave
owns it (H2 `src/persist/**`, H3 `src/ui/**` + CSS).

## Step 3 — Gates

Final state when this report was written (~15 min after H1/H3 landed):

- `pnpm exec tsc --noEmit` — **zero errors in `src/render/**`**. Two errors remain in the wave, both
  in H3's test files (`src/ui/derive.test.ts:55`, `src/ui/structure-card.test.ts:109`): a partial
  `GameState` stub whose `arrivals` is optional, so it no longer satisfies the type. Not mine, not
  fixed — the plan says note and re-run, don't fix another task's file. They clear when H3 adds
  `arrivals` to its helper.
- `pnpm exec vite build` (the bundling half of `pnpm build`) — green, 640 kB / 165 kB gzipped.
  `pnpm build` itself runs `tsc --noEmit && vite build`, so it currently fails at step one for the
  H3 reason above.
- `pnpm test` — **209/209 green**, all 11 files (baseline 180 plus the wave's 29). Earlier polls
  caught H1's and H3's red phases (200/209); both cleared.

Run log: my first gate failed only on `TS2678: Type '"hut"' is not comparable to type
'StructureKind'` plus the `FOOTPRINT` excess-property error — H1's concurrent type addition, which
had not landed yet. I polled `src/sim/types.ts` until it did, per the wave's dependency note; the
interim output also showed H1's and H2's in-flight red state (`src/sim/huts.test.ts`,
`src/persist`), which I did not touch.

Beyond the gates, I checked the geometry numerically with three in Node rather than by eye (no
browser, per the task rules): running the exact four parts through the same compose-then-merge
pipeline `bake` uses, `mergeGeometries` returns a real geometry — 94 vertices, 48 triangles,
identical attribute sets across all four pieces, bounds x ±0.589, y 0 → 1.067, z ±0.580, bounding
sphere r = 0.979. That last check is the one that matters: had any part been non-indexed, the merge
would have returned `null` and `bake` would have silently produced an **empty** hut.


## Micro-round — walk-in gait (concern 2, ruled: use the walking gait)

`src/render/villagers/motion.ts` — `'arriving'` now falls through into the `'walking'` branch:

```ts
case 'walking':
case 'arriving': {
  const step = t * STEP_RATE;
  out = { bob: Math.abs(Math.sin(step)) * BOB_STEP - BOB_STEP / 2, lean: 0.06, swing: Math.sin(step) * 0.5, raise: 0, stir: 0 };
```

The smallest edit that rules the concern out: H1 holds `state === 'arriving'` for the entire walk, so
before this the newcomer rendered the `idle`/`default` arm — no step bob, no arm swing, a glide. Now
the walk-in gets the same gait as any walker, driven by the same `STEP_RATE` and offset by the same
`rig.phase` hash, so nothing about the walk cycle is duplicated and nobody animates in lockstep.
`idle`, `working` (all three sub-branches) and `resting` are untouched, and the post-arrival flip to
`'idle'` stands the newcomer down exactly as it does for a keeper. `VillagerState` gains no member
here — the render layer just reads the sim's.

The `selectionCue.ts` footprint key from the first round is **blessed and staying** (`hut: 0.66`).
It is load-bearing twice over: it completes the total `Record<StructureKind, number>` so H1's `'hut'`
member type-checks, and without it `FOOTPRINT['hut']` is `undefined` → `NaN` on the cue's scale the
first time a player selects a hut. Its value is the hut's own 0.58 half-extent plus air, which is
what that table's comment defines the column as.

Gates after the edit: `pnpm test` **209/209 green** (11 files); `vite build` green; `tsc --noEmit`
**zero errors in `src/render/**`**. `pnpm build` still trips at its `tsc --noEmit` step on one
out-of-scope fixture — `src/ui/structure-card.test.ts:109`, H3's partial `GameState` with an optional
`arrivals`. Re-polled for ~9 minutes; H3 cleared its other fixture (`src/ui/derive.test.ts:55`) during
the wait and this last one is still open. Not mine, not fixed.

## Concerns for the orchestrator

1. ~~**The walk-in pose is missing**~~ — **resolved in the micro-round above**: `'arriving'` falls
   through into the `'walking'` branch in `motion.ts`, so the walk-in walks. Nothing outstanding.
2. **`villagers/index.ts:82` allocates per frame** (`new Set(state.villagers.map(...))` in the
   liveness sweep) — pre-existing, unrelated to 8 vs 12, and `structures.ts` already does this the
   right way with a reused set. Out of my mandate ("only if an 8-length assumption exists"), so
   untouched; worth a follow-up if the per-frame-allocation budget is ever audited strictly.
3. The door's contrast against the trunk wall is a judgement call the live pass should confirm —
   `cauldron` (#6b6660) on `trunk` (#7a5941) is a hue shift (grey on orange-brown) rather than a
   value one. If it reads as a smudge at play distance, `soil` on the pad / a darker door is a
   one-token change; adding a palette key was avoided on purpose.
