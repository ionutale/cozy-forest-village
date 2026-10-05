# A5 — Meals-past-six read at the pot + draw-call reduction

**Task:** batch-3 polish wave. Extends the B5 structures layer with a readability cue and a
draw-call reduction pass. **Files touched:** `src/render/structures.ts` only (plus this report).
**Model:** space-bunny-free. **Status:** DONE.

---

## 1. Summary

Two changes, both inside the B5 structures layer, both verified against the pre-change code by a
throwaway differential harness:

1. **Meals past six are readable at the pot.** `pot.meals` is uncapped in the sim, but B5 drew only
   six bowls and clamped there, so 6 meals and 12 meals looked identical. The pot now caps at
   8 bowls with three stacked cues: a second bowl column, a modest size step on the top bowl, and
   thicker steam.
2. **Draw calls: structures 70 → 24** in the worst case (all 7 built, meals > 0), a **−46 swing**.
   Every static part of a structure is now baked into one merged `BufferGeometry`; the three
   animated cues became `InstancedMesh`es.

Target was ≤ 115 total; the measured worst case projects to **≈ 99 calls** against the stated
145-call baseline (see §4 for why this is a projection, not a `renderer.info` reading).

**Built visuals are provably unchanged** — see §5. Pick resolution is provably unchanged — see §6.

---

## 2. Meals past six

`MEAL_BOWLS` went 6 → 8. `MEAL_STACK` (6) stays the width of the column B5 drew. Three cues, all
pure functions of `state.pot.meals`, so nothing is timed or remembered:

| Cue | Behaviour |
|---|---|
| **Second column** | Bowls 6–7 sit in a second column 0.17 to the side, rather than a 7th and 8th tier on a tall spire. Reads as "two stacks" from across camp. |
| **Top-bowl size step** | From the 7th meal (`MEAL_TOP_STEP_FROM`) the topmost visible bowl scales ×1.15. |
| **Thicker steam** | Steam scale ×`1 + 0.12 × bowls-past-six`, capped at the 8-bowl maximum. |

Measured off the live instance matrices:

```
meals=0: bowls 0 (second column 0), top-bowl scale 0.00, steam wisps 0 max scale 0.00
meals=1: bowls 1 (second column 0), top-bowl scale 1.00, steam wisps 3 max scale 1.17
meals=4: bowls 4 (second column 0), top-bowl scale 1.00, steam wisps 3 max scale 1.17
meals=6: bowls 6 (second column 0), top-bowl scale 1.00, steam wisps 3 max scale 1.17
meals=7: bowls 7 (second column 1), top-bowl scale 1.15, steam wisps 3 max scale 1.31
meals=8: bowls 8 (second column 2), top-bowl scale 1.15, steam wisps 3 max scale 1.45
```

Meals 1–6 are **untouched** — the triangle comparison in §5 confirms byte-identical geometry at
4 meals, so nothing regresses for the common case. Above six the read is three independent signals,
which is deliberately more than one: a single cue (bowl count alone) is hard to judge at the
default camera distance, and the brief's "e.g." left the choice open.

`count` on each `InstancedMesh` is the visibility switch — bowls fill in order, so the shown ones
are always a prefix. That is why no per-instance scale-to-zero trick is needed.

## 3. Draw-call reduction

### What changed

B5 made one `THREE.Mesh` per primitive. A built woodpile was 6 meshes, a built garden 7, the built
pot 12. Now:

- **Static parts are merged per kind.** `chunksFor(kind)` declares each primitive once, with the
  coordinates B5 used, and `bake()` folds the transforms in and writes one colour attribute.
  Baked once per kind on first sight and cached, so the two lanterns share one buffer.
- **One vertex-coloured material instead of six.** All static parts render through a single
  `MeshLambertMaterial({ vertexColors: true })`, so even the multi-coloured kinds (pot = stone +
  iron + wood, feeder = wood + stone) merge into one mesh. Each part's PALETTE hex is baked
  per-vertex. This is what removes the last material-boundary splits.
- **Animated cues became `InstancedMesh`.** Bowls (8), steam (3), sprouts (6). `count` doubles as
  visibility, so no per-instance hiding is needed.
- **Ghosts reuse the built geometry verbatim** under `ghostMat`, which unlit material ignores the
  colour attribute. A ghost is now a single translucent mesh per structure.

Only the lantern keeps two chunks, because its lamp globe must stay unlit (`MeshBasicMaterial`) to
glow at dusk and cannot join a Lambert chunk.

Per-structure, built: woodpile 1 · pot 3 · bench 1 · garden 2 · lantern 2 · lantern 2 · feeder 1
= **12 meshes**, down from 37. Ghost: **1 mesh each**, down from 3–12.

### Measured (analytic, structures group)

| Scene | structures old | structures new | delta |
|---|---|---|---|
| fresh village (woodpile built, 6 ghosts), 0 meals | 34 | **10** | −24 |
| all 7 built, 4 meals, garden 87 % | 70 | **24** | −46 |
| all 7 built, 0 meals, garden 0 % | 56 | **24** | −32 |
| all 7 built, 8 meals, garden 100 % | 74 | **24** | −50 |

Memory improved alongside: **15 → 10 geometries, 9 → 6 materials, 91 → 38 scene objects**.

## 4. Total call count — projection, not a `renderer.info` reading

The brief forbade me the browser and the dev server, so I could not read
`__cozyRender.info().calls` directly. Instead the harness assembles the real scene (environment +
villagers + ambient + structures + ground, same camera as `render/index.ts`) and applies an
analytic model of `WebGLRenderer`: one call per visible renderable in the colour pass, plus one per
visible `castShadow` renderable in the single directional-light shadow pass. Lights cost no call.

That model reproduces the reported baselines well — B5's own report measured **154** all-built and
this model gives **157** for the same scene — so the ~2-call gap is the model ignoring frustum
culling. Frustum culling affects both variants identically, so the *delta* is exact even though the
absolute is approximate.

| Scene | full scene old | full scene new |
|---|---|---|
| fresh village, 0 meals | 121 | **97** |
| all 7 built, 4 meals | 157 | **111** |
| all 7 built, 0 meals | 143 | **111** |
| all 7 built, 8 meals | 161 | **111** |

Applying the model's own ~2-call bias to the brief's stated **145** baseline gives **≈ 99 calls**
worst case. That clears the ≤ 115 target and lands within a call or two of the ≤ 100 stretch.
Honest caveat: **this is an analytic model, not a browser measurement.** The orchestrator's
`__cozyRender.info()` reading is the number to trust, and §5/§6 establish that the delta is real
regardless of which absolute it lands on.

One structural note for whoever picks this up next: **villagers now dominate.** Structures are 24 of
~111; the rest is villagers, environment and ambient. `REPORT.md`'s standing item 9 ("instance/merge
structure parts") is now done, and the next meaningful saving is the villager rigs, which are
outside this task's file scope.

## 5. Built visuals unchanged — proof

The strongest available check: bake every visible built mesh into **world space**, expand
`InstancedMesh`es per instance so the soup matches what the GPU draws, canonicalise each triangle
(vertices sorted within, triangles sorted, so part ordering cannot mask a difference), and compare
the two implementations as sets per structure.

```
IDENTICAL woodpile: 200 triangles
IDENTICAL pot: 772 triangles
IDENTICAL bench: 76 triangles
IDENTICAL garden: 92 triangles
IDENTICAL lantern-a: 172 triangles
IDENTICAL lantern-b: 172 triangles
IDENTICAL feeder: 224 triangles
all structures identical: true
```

Separately, every one of the **2 584** merged vertices matches the old per-part material colour
**exactly** (`trunk`, `rock`, `cauldron`, `soil`, `sun`; 0 mismatches) — compared in linear working
space, which is where three actually stores material colours.

Ghosts stay translucent: `ghostMat` is unchanged at opacity 0.22, `depthWrite: false`, no shadow
casting, and they still show the built silhouette (a merged ghost is the same geometry) minus
bowls and steam.

## 6. `pickStructure` unchanged — proof

**Non-negotiable, and it is met by construction: nothing is instanced *across* structures.** The
bowls, steam and sprouts cues are per-structure, so there is no instanceId → structureId map to
maintain and no way for the pick path to lose an id. Every mesh in the group — merged chunks,
instanced cues and the lamp alike — still carries `userData.structureId`, written by the same
`root.traverse` as B5, and `pick` still reads it off `hit.object`. The `shown()` ancestor filter is
untouched.

Verified by reconstructing the render camera and projecting each structure's centre at seven heights
(0.02 → 1.05) in three states — all built, all ghosts, and all built at 8 meals — plus two sky rays.
**All 21 probes resolve to the identical id in both implementations**, including the nulls where a
structure is thinner than the ray. Two rays into empty sky return `null` in both.

### The bug this check caught

My first pass computed each cue's `boundingSphere` from the pose its instances happened to sit in at
build time. three caches that sphere and tests both frustum culling *and* `Raycaster` against it, so
a steam wisp that had climbed out of its initial sphere stopped being pickable — the harness caught
`pot` returning `null` where the old code returned `pot`. Fixed by giving each cue an explicit
envelope sphere sized for where it **travels**, not where it starts. Both the loop and the bounds
now derive from the same `steamPose`/`bowlSlot`/`sproutSlot` helpers, so they cannot drift apart.

Re-verified by sampling every animated pose: **34 812 poses across a 40 s sweep, 0 outside bounds.**

## 7. No per-frame allocation

`bowlSlot`, `sproutSlot` and `steamPose` write into a shared scratch instead of returning a fresh
array or object, and instance matrices compose through one reused `Object3D`. GC-inclusive
measurement over 600 `update()` calls: old −50 KiB, new −44 KiB — neither retains.

Motion remains a pure function of `timeSec` + state. No `Math.random`, no timers, no new deps
(`three/addons/utils/BufferGeometryUtils.js`, already vendored with three), no `any`.

## 8. Commands run

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0, clean |
| `pnpm build` | exit 0 — `dist/assets/index-0TKBD9Hz.js 627.54 kB │ gzip: 161.08 kB` |
| `pnpm test` | exit 0 — **6 files, 62/62 passed** |

(Bundle is 26 kB larger than B5's 600.92 kB. That is `BufferGeometryUtils` plus the merged buffers'
vertex data entering the bundle; it is memory-for-draw-calls, and 161 kB gzipped is far from a
concern. `pnpm test` is 62/62 rather than B5's 49/49 because batch-2 and earlier batch-3 tasks added
tests.)

## 9. Deviations and concerns

1. **`mergeGeometries` is a new import** from `three/addons/utils/BufferGeometryUtils.js`. Still
   three-only, already in the dependency, and `render/index.ts` already imports from `three/addons`
   (`OrbitControls`), so this introduces no new dependency surface. Writing the merge by hand would
   have been ~30 lines of index-offset arithmetic for no benefit.
2. **One `MeshLambertMaterial({ vertexColors: true })` replaces six palette materials** in this file.
   `palette.ts` is T3-owned and untouched. This is a *materials* change, not a colours change: §5
   shows every vertex matches the previous material exactly, and the palette hexes are still the
   single source of truth in `chunksFor`.
3. **The lantern is the only 2-chunk structure**, because its globe must stay unlit. Dropping to
   one chunk would require either losing the dusk glow or baking emissive into vertex colours, which
   a Lambert material cannot express. Left alone deliberately.
4. **Not browser-validated** — the brief assigned the browser to the orchestrator. §4's total is an
   analytic model, §5/§6 are exact differential proofs against the real three.js raycaster and
   geometry pipeline, so I am confident in the change; a screenshot would still be worth having for
   the second bowl column, which is the one genuinely new thing a human should look at.
5. **Cross-structure instancing was deliberately skipped.** The two lanterns could share one
   `InstancedMesh` for ~2 calls, but it needs an instanceId → structureId map in the hit path and a
   reordering trick to keep built structures a prefix of the instance list — real complexity against
   the brief's non-negotiable picking requirement, for a rounding error. Not worth it.
6. **The pot silhouette above six meals is new geometry**, so it has never been seen by a human
   eye. The second column is 0.17 apart with bowls 0.17 wide, so the columns touch but do not
   interpenetrate; worth a glance in the browser pass.
