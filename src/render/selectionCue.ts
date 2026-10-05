// B2: the layer can also say *which* structure is selected, because clicking one opens a card in
// the popover and the world must show what it is about. One shared ground cue — a wide soft halo
// under a thin warm ring — encircles the selected footprint, ghost or built alike. It is a
// deliberate sibling, not a twin, of the villager ring in `villagers/ring.ts`: this one is wider
// and its accent band is thinner, so a villager standing inside a selected structure still reads
// as two separate things. Both meshes are untagged, exactly like that ring, so they are invisible
// to `pick` and cannot steal or shadow a hit (a hit on the cue is skipped, the scan continues).
//
// WD2: lifted out of `structures.ts` unchanged — the rings, their fade state, and the two motions
// that animate them. The host still owns picking and disposal: the geometries and materials below
// are built through the `track` it passes in, so they ride its disposables list. The host's
// `update` calls `update(state, timeSec)` once per frame, after its own model sweep.

import * as THREE from 'three';
import type { GameState, StructureKind } from '../sim';
import { PALETTE } from './palette';

export interface SelectionCue {
  setSelected(id: string | null): void;
  update(state: GameState, timeSec: number): void;
}

/* --- B2: the selection cue -----------------------------------------------------------------
 * A footprint radius per kind, so the ring hugs what it marks rather than floating at one size:
 * a wide bench gets a wide ring, a lantern pole a tight one. Values are the model's own extent
 * (`chunksFor`) plus a little air, rounded to what reads on grass. */
const FOOTPRINT: Record<StructureKind, number> = {
  woodpile: 0.44,
  pot: 0.48,
  bench: 0.6,
  garden: 0.72,
  lantern: 0.3,
  feeder: 0.34,
};
const CUE_Y = 0.035; // above the grass (0), the clearing disc (0.01) and the garden patch (0.02)
const CUE_FADE_MS = 220; // DESIGN §2 pillar 4: the cue eases in and out, it never snaps
const CUE_PERIOD_S = 1.4; // breath period → 0.71 Hz, inside the 0.6–0.8 Hz band
const CUE_BREATH = 0.04; // peak scale 1.00 → 1.08, i.e. ≤ ±8 % of the resting size
const CUE_HALO_MAX = 0.5; // resting opacity once fully faded in; soft enough to sit on grass
const CUE_RING_MAX = 0.85; // the thin warm band on top, the half that actually reads as "selected"

export function createSelectionCue(
  parent: THREE.Group,
  track: <T extends { dispose(): void }>(item: T) => T,
): SelectionCue {
  /* --- B2: the selection cue -------------------------------------------------------------
   * Two flat rings in unit space, scaled to whichever footprint is selected: a wide soft halo
   * underneath, a thin warm ring on top — the same two-tone trick the villager ring uses, but
   * wider and thinner so the two never read as the same mark when a villager stands on the
   * selected structure. `RingGeometry` is built in the XY plane and laid flat by rotation, so the
   * footprint scale goes on x and y; the band therefore thickens slightly with the footprint,
   * which reads as "a ring sized to this thing" rather than a fixed gauge.
   *
   * Nothing here is tagged `structureId`, so `pick` skips a hit on the cue exactly as it skips a
   * hit on the villager ring, and the hit scan continues to the structure behind it. */
  const selCueHaloGeo = track(new THREE.RingGeometry(0.74, 1, 48));
  const selCueRingGeo = track(new THREE.RingGeometry(0.955, 1, 48));
  const selCueHaloMat = track(new THREE.MeshBasicMaterial({
    color: PALETTE.flowerWhite,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  const selCueRingMat = track(new THREE.MeshBasicMaterial({
    color: PALETTE.accent,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  const selCue = new THREE.Group();
  const selCueHalo = new THREE.Mesh(selCueHaloGeo, selCueHaloMat);
  const selCueRing = new THREE.Mesh(selCueRingGeo, selCueRingMat);
  selCueHalo.rotation.x = selCueRing.rotation.x = -Math.PI / 2;
  selCueHalo.renderOrder = 1;
  selCueRing.renderOrder = 2; // the halo can never win a transparent sort against the ring on top
  selCue.add(selCueHalo, selCueRing);
  selCue.visible = false;
  parent.add(selCue);

  // Fade state. `setSelected` records the id; `update` resolves it against the live state
  // and eases toward the result, so the cue breathes in and out of existence instead of popping
  // (DESIGN §2 pillar 4).
  let cueId: string | null = null;
  let cueKind: StructureKind | null = null; // last resolved kind; survives a clear so a fade-out
  let cueFound = false; //   ...shrinks from where the ring actually was
  let cueAmount = 0; // eased 0..1
  let cueFrom = 0;
  let cueTo = 0;
  let cueFadeStart = 0;

  /** Start a fresh `CUE_FADE_MS` ease from wherever the cue currently is toward `target` (0 or 1).
   *  Re-arming mid-fade is what lets the cue change its mind without jumping. */
  function retarget(target: number, timeSec: number): void {
    if (target === cueTo) return;
    cueTo = target;
    cueFrom = cueAmount;
    cueFadeStart = timeSec;
  }

  /**
   * B2: resolve the selection, ease `cueAmount` toward it, and pose the ring. Pure arithmetic over
   * scalars — no allocation, no timer, no Math.random.
   *
   * `found` is whether `cueId` named a structure that exists in this frame's state. It is the
   * *only* thing that decides the target, so an id the state has never heard of — a click that
   * raced a reset, a stale id from a previous village — lights nothing, and a structure that
   * disappears under a live selection fades out on its own.
   *
   * Two motions, both gentle by construction:
   * - the **fade** runs `CUE_FADE_MS` and is smoothstepped, so the cue swells in and shrinks out
   *   rather than popping (pillar 4);
   * - the **breath** is a cosine whose period is `CUE_PERIOD_S` (1.4 s ≈ 0.71 Hz) and whose peak
   *   deviation from the resting scale is `CUE_BREATH` (0.04 × 2 = 8 % peak-to-peak), half what a
   *   hard pulse would be and nowhere near a strobe.
   *
   * The two are multiplied, not added: the ring is at full size whenever it is fully opaque and at
   * 0 whenever it is invisible, so the size and the opacity can never disagree.
   */
  function advanceCue(timeSec: number, found: boolean): void {
    retarget(found ? 1 : 0, timeSec);
    const span = CUE_FADE_MS / 1000;
    const t = span > 0 ? Math.min(1, Math.max(0, (timeSec - cueFadeStart) / span)) : 1;
    const eased = t * t * (3 - 2 * t); // smoothstep: zero slope at both ends, so no visible seam
    cueAmount = cueFrom + (cueTo - cueFrom) * eased;
    const radius = cueKind === null ? 0 : FOOTPRINT[cueKind] * cueAmount;
    selCue.visible = cueAmount > 0.001;
    selCueHaloMat.opacity = CUE_HALO_MAX * cueAmount;
    selCueRingMat.opacity = CUE_RING_MAX * cueAmount;
    const breath = 1 + (1 - Math.cos((timeSec * Math.PI * 2) / CUE_PERIOD_S)) * CUE_BREATH;
    selCue.scale.setScalar(radius * breath);
  }

  return {
    setSelected(structureId: string | null): void {
      if (structureId === cueId) return; // a re-click on the same structure is not a change
      cueId = structureId;
      // The fade target is *not* decided here: an id that names no live structure must not light
      // anything, and only `update()` can know that. It resolves `cueId` against the state every
      // frame and calls `retarget`, so an unknown or already-removed id simply eases back out.
    },
    update(state: GameState, timeSec: number): void {
      cueFound = false; // re-armed below by whichever structure carries the selected id
      // B2: the cue trails the selected id, whatever state the model is in — the host's per-kind
      // sweep has already run (ghosts included) by the time this is called, so a ghost footprint
      // is ringed exactly like a built one.
      const structures = state.structures;
      for (let i = 0; i < structures.length; i++) {
        const structure = structures[i];
        if (structure === undefined || structure.id !== cueId) continue;
        cueKind = structure.kind;
        cueFound = true;
        selCue.position.set(structure.pos.x, CUE_Y, structure.pos.z);
        break;
      }
      advanceCue(timeSec, cueFound);
    },
  };
}
