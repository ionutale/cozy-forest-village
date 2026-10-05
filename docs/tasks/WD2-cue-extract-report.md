# WD2 Report — extract the structure selection cue into `src/render/selectionCue.ts`

**Status: DONE. No commit. Only `src/render/structures.ts`, `src/render/selectionCue.ts` (new)
+ this file touched.**
**Date:** 2026-10-05

## What moved (module map)

The cue was a single cohesive block in `src/render/structures.ts`; it now lives in
`src/render/selectionCue.ts` behind a factory. Every line below was moved verbatim — the
easing math, the geometry/material parameters, the untagged meshes and the comment intent are
byte-for-byte what they were (proved mechanically, see *Equivalence evidence*).

| From `structures.ts` (HEAD) | To `selectionCue.ts` | What |
|---|---|---|
| header L17–24 (B2 paragraph) | L1–15 | file header: what the cue is, why it is a sibling (not a twin) of `villagers/ring.ts`, and why both meshes must stay untagged |
| L63–80 | L23–40 | `FOOTPRINT` per-kind radii + `CUE_Y`, `CUE_FADE_MS`, `CUE_PERIOD_S`, `CUE_BREATH`, `CUE_HALO_MAX`, `CUE_RING_MAX` |
| L190–224 | L56–80 | halo + ring geometries through `track`, materials, `-π/2` lay-flat, `renderOrder` 1/2, `selCue` group, `visible = false`, `group.add(...)` |
| L226–235 | L83–91 | fade state: `cueId` / `cueKind` / `cueFound` / `cueAmount` / `cueFrom` / `cueTo` / `cueFadeStart` |
| L480–487 | L93–102 | `retarget(target, timeSec)` |
| L489–520 | L104–131 | `advanceCue(timeSec, found)` — smoothstep fade × cosine breath, unchanged |
| L614–620 | L136–141 | the `setSelected` body (early return on same id; target deliberately not decided here) |
| L525 + L538–544 + L604 | L143–158 | cue resolution: reset `cueFound`, resolve `cueId` against `state.structures` (kind + position), then `advanceCue` |

### What stayed in `structures.ts`

Everything else: the merged-geometry baking, `chunksFor`/`chunksOf`, `buildModel`/`createPair`,
the bowls/steam/sprouts instancing, `pick`, `dispose`, and the **`StructuresLayer` contract** —
`setSelectedStructure(structureId: string | null): void` keeps its exact signature and now just
delegates (`structures.ts:502`). `src/render/index.ts` and `src/main.ts` are untouched.

The unrelated `cue(...)` helper at `structures.ts:237` (the InstancedMesh constructor for
bowls/steam/sprouts) is *not* part of the selection cue despite the name; it stayed put.

### The new module's surface

```ts
export interface SelectionCue {
  setSelected(id: string | null): void;
  update(state: GameState, timeSec: number): void;
}
export function createSelectionCue(
  parent: THREE.Group,
  track: <T extends { dispose(): void }>(item: T) => T,
): SelectionCue
```

Nothing else is exported. The factory adds **no `dispose`**: both ring geometries and both ring
materials are constructed through the `track` the host passes in (`selectionCue.ts:56–71`), so
they land in `structures.ts`'s existing `disposables` array and are released by the unchanged
`StructuresLayer.dispose()`. The factory is called at `structures.ts:170`, immediately after the
`track` definition and the shared materials — i.e. exactly where the cue used to be built, so
`selCue` is still `group.children[0]` and disposal order is unchanged.

## Line counts

| File | Before (HEAD) | After | Δ |
|---|---:|---:|---:|
| `src/render/structures.ts` | 629 | **512** | −117 |
| `src/render/selectionCue.ts` | — | **160** | +160 |
| total | 629 | **672** | +43 |

The +43 is pure wrapper: file header (15), imports (3), the exported interface (5), the factory
signature (4), the returned object's two methods (4) and blank/section lines. No logic duplicated
between the two files — `grep -n 'CUE_\|FOOTPRINT\|cueAmount\|advanceCue\|retarget'` in
`structures.ts` returns nothing.

## Deliberate structural change (the one non-move)

The cue's resolution used to sit **inside** the `state.structures.forEach` of
`StructuresLayer.update`, guarded by the `if (!structure.built) return` that follows it. The new
API (`update(state, timeSec)`) cannot be handed a per-structure callback, so `selectionCue.update`
runs its own index loop over `state.structures` (`selectionCue.ts:149–155`) and is called from the
host at `structures.ts:491`, i.e. **after** the model sweep and liveness sweep, where `advanceCue`
used to be called.

Equivalence: the old block ran for *every* structure including ghosts (it is above the ghost
early-return), so the extracted loop — which has no early return — resolves exactly the same set.
It allocates nothing (index loop, no closure, no `for…of` iterator), `break`s on first match
(ids are unique), and only writes `cueKind`/`cueFound`/position when found, so a cleared or
unknown id still fades out from the last resolved footprint. Nothing reads `cueFound` between the
old reset point (top of `update`) and the old `advanceCue` call (bottom), so moving all three
inside one function is unobservable.

Two comments were updated by necessity, both purely mechanical renames, intent preserved:
`setSelectedStructure` → `setSelected` in the fade-state comment, and `group` → `parent` in the
moved `group.add(selCue)` line. The "checked before the ghost early-return, so a ghost footprint
is ringed exactly like a built one" intent was carried to both call sites (`selectionCue.ts:147`
and `structures.ts:489`).

## Verification

All failures below are in `src/ui/**` — *untracked/modified concurrent work that does not import
`src/render/**`*. **Zero tsc errors in `src/render/**`** (`tsc --noEmit | grep -c src/render` → 0).
Not fixed, per brief.

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | **out-of-scope errors only.** First run this task: 2 × `TS6133` unused `COOK_BERRIES`/`COOK_WOOD` in `src/ui/derive.ts`. Re-run at completion, the UI agent having edited further mid-task: those 2 **plus 6 in `src/ui/index.ts`** (missing `STRUCTURE_NAMES` export, unused locals, `string \| undefined` assignment). None in `src/render/**`. |
| `pnpm build` (= `tsc --noEmit && vite build`) | blocked by the same out-of-scope errors. |
| `pnpm exec vite build` (the build half, run alone) | **✓ when run immediately after this refactor** — 30 modules, `dist/assets/index-*.js` 630.29 kB / 162.07 kB gzip (chunk-size warning pre-existing). Re-run at completion: fails with `[MISSING_EXPORT] "STRUCTURE_NAMES" is not exported by "src/ui/derive.ts"` — the concurrent UI edit in flight, unrelated to this change. |
| `pnpm test` | **✓ 66/66 across 7 files** (run twice, before and after the concurrent UI edits). Brief expected 63/63; the 3 extras are the concurrent tree's new `src/sim/obstacles.test.ts`. All 63 pre-existing tests still green. |

### Equivalence evidence (throwaway, outside the repo)

Because tests cannot be added to the repo for this task, the refactor was proven behaviourally
identical with a throwaway harness built in the system temp dir (never written to the repo,
never committed):

- both `structures.ts` revisions (HEAD's and the refactored one, each with its own cue) were
  bundled side by side and driven by one scripted timeline — **376 frames at 50 ms** covering:
  idle → select a built structure → re-click the same id (no-op) → deselect → select a **ghost**
  → select an **unknown id** → select a structure that **flips ghost→built mid-selection** → a
  **new structure appears** while selected → the **selected structure is deleted** mid-fade →
  a full **village wipe** under a live selection.
- every frame compared: cue child index in `group`, `visible`, `position`, `scale`, halo **and**
  ring `opacity`, both colours, both `RingGeometry` inner/outer/theta params, `side`, `rotation.x`,
  `renderOrder`, `depthWrite`, and `userData.structureId` on both meshes, plus the host group's
  child count.

**Result: `frames compared 376, mismatches 0`** → `EQUIVALENT`. Also checked: both cue meshes stay
untagged every frame (so `pick` still skips them and the scan continues to the structure behind),
and `dispose()` leaves `group.children.length === 0` on both sides.

Static proof on top of that: a script diffed each moved block against its destination —
`constants`, `fadestate`, `retarget`, `advanceCue`, and all four comment/doc blocks came back
**byte-identical**; `meshes` differed only on `group.` → `parent.`; the `setSelected` body came
back byte-identical after the signature line.

## Concerns

1. **Out-of-scope `tsc`/`build` failure.** `src/ui/derive.ts` and `src/ui/index.ts` (concurrent,
   untracked/modified) fail `tsc` and `vite build` — the UI agent is mid-edit (`STRUCTURE_NAMES`
   imported but not yet exported). Expected to be fixed by its owner; this task did not touch it.
   `src/render/**` contributes zero errors and `vite build` passed standalone right after this
   refactor.
2. **Test count drift.** 66 tests now, not the 63 in the brief — concurrent additions, all green.
3. **Extra pass.** The cue now walks `state.structures` a second time each frame (index loop,
   no allocation, ~7 entries). Negligible, but it is a real difference from the single-pass
   original; it is forced by the required `update(state, timeSec)` signature.
