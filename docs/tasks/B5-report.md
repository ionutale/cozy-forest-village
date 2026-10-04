# B5 Report — Render: structures (built + ghosts) and world picking

Status: **DONE**. All acceptance criteria verified, including live browser validation
(chrome-devtools, `pnpm dev` on :5177). Changes left uncommitted in the working tree.

## Files

| File | Lines | Change |
|---|---|---|
| `src/render/structures.ts` | 251 | **new** — `createStructures()` / `StructuresLayer`, six models, ghosts, picking |
| `src/render/index.ts` | 191 (+21) | layer create/update/dispose, `pickStructure`, `env.update(timeSec, state.fire)` |
| `src/render/palette.ts` | 27 (+2) | `soil`, `cauldron` |

`git status` shows exactly those three source files (plus the new validation PNGs). No commit.
No new dependencies, no `any` (grep-verified), no UI work, no villager poses.

Validation artifacts:

- `docs/validation/B5-ghosts-default.png` — fresh village: the built woodpile plus all six
  translucent ghosts on the ring
- `docs/validation/B5-pot-ghost-closeup.png` — ghost pot close-up (ring + cauldron only) with
  ghost bench / garden / lanterns / feeder in frame
- `docs/validation/B5-built-default.png` — all seven structures built, `meals: 4`, garden ~87 %
- `docs/validation/B5-closeup.png` — built pot with a bowl stack and rising steam, half-grown
  garden sprouts, lit lanterns

## What was built

### Models (`buildModel(kind, ghost)`)

One function builds **both** variants from the same code path, so "same geometry" is true by
construction rather than by discipline: `ghost = true` swaps every material for the single shared
`ghostMat` and skips the point light. Geometry instances are module-level per layer and shared by
every structure and both variants.

| Kind | Parts | Notes |
|---|---|---|
| `woodpile` | stump cylinder + 5 log cylinders in two rows | pre-built; drops a soft shadow |
| `pot` | stone torus ring, cauldron (sphere cut to 62 % polar), leaning stirrer, 6 bowl slots, 3 steam wisps | bowls/steam are hidden on the ghost — a ghost pot shows the promise, not the contents |
| `bench` | 2 log legs + plank seat (0.92 × 0.34) | faces the fire |
| `garden` | dark tilled disc (r 0.62) + 6 cone sprouts in two rows of three | sprouts scale with `gardenMs`, staggered |
| `lantern` | post + self-lit lamp head + `PointLight(#e08a3c, 0.5, 6, 1.4)` | light only in the built variant, no shadows |
| `feeder` | post + stone tray + 3 seeds | |

All models are yawed with `atan2(-pos.x, -pos.z)` so their **+z front faces the campfire** — a
decision the brief did not specify (noted below).

### Ghosts

One `MeshBasicMaterial` — warm off-white (`PALETTE.flowerWhite`), `opacity 0.22`,
`depthWrite: false` — on the identical geometry. `MeshBasic` means ghosts are unlit, so all seven
read at the same value regardless of orientation. `castShadow` is set from
`material !== ghostMat`, so no ghost ever enters the shadow pass. Ghosts are **static**: the update
loop returns early for unbuilt structures.

Worth noting for the "ghosts must be visible" criterion: all six ring spots sit at r = 5.2 while
the clearing disc is r = 4.2, so every ghost stands on **grass**, not on the tan disc — the warm
off-white has good contrast there.

### Animated parts (built only, all pure functions of `timeSec` + state)

- **Bowls**: `bowl.visible = k < min(pot.meals, 6)`, so the stack grows with the meal count.
- **Steam**: 3 wisps, `rise = (timeSec * 0.35 + k/3) % 1`, rising 0.5 → 1.05 while scaling
  0.55 → 1.4. Position/scale only — the material is shared, so opacity stays constant and there is
  no per-frame material churn.
- **Sprouts**: `growth = clamp(gardenMs / 30000)`, then each sprout `k` has
  `delay = k/6 * 0.5` and `t = clamp((growth - delay) / (1 - delay))`, applied as
  `scale.set(1, max(0.04, t), max(0.04, t))` so the patch fills in unevenly instead of popping in
  unison. A ±0.05 rad sway at 1.1 rad/s keeps it alive (pillar 4).
- **Lantern light**: `0.5 * (1 + sin(timeSec * 0.9 + i) * 0.08)` — an ±8 % breath, per-structure
  phase from the roster index, so two lanterns never pulse together.

No `Math.random`, no timers, nothing cached outside the layer: `GARDEN_PERIOD_MS = 30000` mirrors
the sim constant and is commented as such.

### Picking

`StructuresLayer.pick(raycaster)` walks `intersectObjects(group.children, true)` and returns the
first hit whose `userData.structureId` is a string. Every mesh of both variants is tagged at
creation, and every hit is filtered through `shown(obj)` — a 3-line ancestor walk that checks
`visible`. That filter is **necessary**, not defensive: three.js `Raycaster.intersect()` tests
`object.layers` but never `object.visible` (verified in
`node_modules/three/src/core/Raycaster.js`, `intersect()` at line 240), so the hidden half of every
built/ghost pair would otherwise be raycast. Both variants share a `structureId`, so without the
filter the answers would usually still be right — but a hidden variant could win a hit that belongs
in front of it, and the intent would be wrong.

`pickStructure` on `RenderHandle` mirrors `pickVillager` exactly: canvas rect → NDC →
`raycaster.setFromCamera` → delegate, with the same degenerate-rect guard. The **single**
`Raycaster` and NDC/scratch vectors in `initRender` are shared by both picks. Structure selection
state is untouched — the villager ring and `selectedId` know nothing about structures, so B7 can
drive either independently.

### Integration fix

`env.update(timeSec, state.fire)` — one line at the call site. B4's `Environment.update` signature
is `(timeSec: number, fire?: Fire)` and falls back to the `__cozy` hook when the argument is
omitted; the render layer now passes the real state. The ambient and villager calls are unchanged.

## Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm build` (tsc + vite build) | exit 0 — `dist/assets/index-D7Tpcnud.js 600.92 kB │ gzip: 153.38 kB` |
| `pnpm test` | exit 0 — 6 files, 49 tests passed |

## Browser validation (chrome-devtools, `pnpm dev` on :5177, 1440×900 CSS)

Console: clean at boot, with ghosts, with everything built, and after repeated pick sweeps — no
errors, no warnings.

**Draw calls** (`__cozyRender.info()`), the `< 200` budget:

| Scene | calls | triangles | geometries |
|---|---|---|---|
| Fresh village (woodpile built + 6 ghosts) | **120** | 28 052 | 36 |
| All 7 built, pot at 4 meals, garden ~87 % | **154** | 29 880 | 38 |

The all-built figure is the worst case (every structure fully detailed, both lantern lights on), so
the budget holds at the ceiling with ~46 calls of headroom.

**Picking — 7/7 by id, ghosts and built.** Because `pickStructure` is not on the `__cozy` hook yet,
I verified it by temporarily adding a probe to `main.ts`, then reverting it. To make the test
trustworthy I first reconstructed the render camera in-page and validated my projection against the
known-good `__cozy.projectVillager` for all 8 villagers: **max error 0.00 px**. Only then did I
project structure positions and probe them.

| Probe | Result |
|---|---|
| Each structure's projected centre, ghosts shown | `woodpile ok · pot ok · bench ok · garden ok · lantern-a ok · lantern-b ok · feeder ok` |
| Same, all structures forced `built: true` | `woodpile ok · pot ok · bench ok · garden ok · lantern-a ok · lantern-b ok · feeder ok` |
| Sky (20, 20) and far grass (60, 860) | `null`, `null` |
| Full click gesture on a ghost | no villager selected (`null`) — the two pick spaces stay independent |

Flipping `built` through the live state object works immediately: the render layer's next
`update()` swaps the variants with no re-creation and no leaked meshes.

**Visual** — from the screenshots:

- Ghosts visible at all six spots, evenly readable on the grass, plus the solid woodpile.
- Ghost pot = stone ring + cauldron only. **No bowl stack and no steam**, confirmed in
  `B5-pot-ghost-closeup.png` — the `ghostMat` bowls/steam are hidden at build time.
- Built pot shows a stack of bowls proportional to `pot.meals` and steam wisps rising above the
  cauldron.
- Built garden shows sprouts at partial height, staggered; soil disc dark and tilled.
- Lantern posts carry a visibly glowing warm lamp head.

Incidental finding: **B3's autosave persisted my injected `built: true` flags across a reload** —
mutating the live state is enough for the save to round-trip it. That is correct behaviour, but it
means "get a fresh village" in a test needs the state mutated rather than localStorage cleared
(autosave rewrites the key before unload). Noted so the next validator is not surprised by it.

## Deviations

1. **`StructuresLayer` has a fifth member, `pick(raycaster)`,** beyond the three in the brief's
   interface snippet. Requirement 2 needs a pick and the layer is the only place that can do it; the
   `RenderHandle.pickStructure` signature is exactly as specified. This mirrors the T05 pattern
   (`VillagersLayer.pick` → `RenderHandle.pickVillager`).
2. **Structures face the campfire** (`atan2(-pos.x, -pos.z)`). Not in the brief. It costs one line at
   model creation and is the difference between a bench that faces the fire and one that faces the
   trees. Deterministic, and overridable later if the orchestrator prefers a fixed yaw.
3. **Two palette entries added** (`soil: '#6a4c37'`, `cauldron: '#6b6660'`). `palette.ts` is T3-owned
   but the brief allows palette additions "only if needed", and both hues are genuinely new: the
   tilled earth is darker than `trunk`, and there is no dark iron in the palette. Everything else
   reuses existing keys (`trunk`, `rock`, `flowerWhite`, `tuftA`, `sun`, `mote`, `fire`).
4. **Ghost colour is `PALETTE.flowerWhite`, not `PALETTE.paper`.** The palette has no `paper` key;
   `#f4efe2` is its warm off-white and sits in the same family as the `--paper` CSS token. The same
   `paper`/`accent` token ruling raised in T05 round 1 still stands — worth adding `paper: '#fdf6e9'`
   to `palette.ts` and switching both the ghost and the T05 selection ring over to it.
5. **The ghost pot hides its bowls and steam.** The brief says ghosts use "the same geometry"; they
   do — the meshes exist and are tagged. A ghost showing six stacked bowls and three steam wisps
   would advertise meals that do not exist yet, which contradicts "a hint of what will stand here".

## Known gaps / concerns for the orchestrator

1. **No automated test covers any B5 code.** The brief's allow-list is three source files, so
   `buildModel`, the growth stagger and the `shown()` visibility filter are verified only by the
   live browser run above. The visibility filter in particular is the kind of thing that breaks
   silently if someone reorders the variant swap, and it is a 6-line pure function — cheap to unit
   test if the allow-list is ever widened. `structures.ts` is also the only render layer with no test.
2. **`render/index.ts` is now 191 lines and `structures.ts` is 251.** No line budget was set for
   batch 2, but for the record: T05's "~220" convention would flag both. `structures.ts` is one
   switch with six cases and would compress by ~40 lines if the models were table-driven; I kept the
   explicit switch because each kind reads as a little drawing and the coordinates are the point.
3. **Each structure keeps two complete models in memory** (7 × 2 groups). They share every geometry
   instance, so this is Object3D overhead only — `geometries` grew 24 → 36 for 15 shared geometries,
   not 15 × 14 — but it is the obvious thing to optimise if the roster grows, by building the ghost
   lazily on first sight of an unbuilt structure. Left as is because the structures are a fixed,
   tiny set and the current form makes the ghost/built symmetry impossible to get wrong.
4. **The garden's sprouts are 6 separate meshes** rather than one `InstancedMesh` — 6 draw calls
   for one structure. Instancing would make it 1 and the per-sprout scale would come from the
   instance matrix, but `userData.structureId` tagging then lives on the `InstancedMesh` (which still
   works for picking). Not done because 6 calls is not the bottleneck at 154 total; worth knowing if
   B8-B9 add more world furniture.
5. **Untested with the real `buildStructure()` path.** I flipped `built` by mutating state rather
   than spending wood through `buildStructure`, because that call is not on the `__cozy` hook. The
   render layer only reads `structure.built`, so the path is equivalent — but B7's UI will be the
   first exercise of build → ghost-to-model swap through the public API, and that transition has not
   been seen end to end.
6. Dev server started on :5177 has been stopped and the port confirmed free, so the tree is clean
   apart from the intended changes and the five new PNGs.