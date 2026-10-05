// Villagers: primitive characters from shared geometry (DESIGN §2 pillar 2 — big head, small body,
// hat as the identity cue) plus T05 selection: every mesh is tagged so a ray hit resolves to a
// villager id, one shared soft ring marks the selection, and `project` anchors the UI / test hook.
// B6 adds the batch-2 poses: a held log while carrying (tend), a stir over the pot (cook), a
// savoring head bob + pooled heart sprites on an `eat` event, and an embers shiver when the fire is
// out. F4 bursts the same pooled hearts on `favor-done` (meal rules, no new geometry). Motion is
// procedural; all smoothing state lives on the rig, so the sim stays pure (DESIGN §3).
//
// Split (A6): `rig.ts` builds the shared kit and the per-villager rigs, `motion.ts` computes poses
// and applies them eased, `hearts.ts` owns the pooled heart sprites, `ring.ts` the shared selection
// ring. This file is the public surface and the per-frame orchestration only.

import * as THREE from 'three';
import type { GameState } from '../../sim';
import { createRig, createRigKit, type Rig } from './rig';
import { animate } from './motion';
import { advanceHearts, createHeartPool, spawnHearts } from './hearts';
import { createSelectionRing, updateSelectionRing } from './ring';

export interface VillagersLayer {
  group: THREE.Group;
  update(state: GameState, timeSec: number, dtMs: number): void;
  /** T05: nearest villager along a ray, the shared selection ring, and rig → NDC projection. */
  pick(raycaster: THREE.Raycaster): string | null;
  setSelected(villagerId: string | null): void;
  /** Writes NDC xy into `out`; false when unknown or behind the camera. */
  project(villagerId: string, camera: THREE.Camera, out: THREE.Vector2): boolean;
  dispose(): void;
}

const PICK_LIFT = 0.5; // project mid-body so the pixel lands on the character

export function createVillagers(): VillagersLayer {
  const group = new THREE.Group();
  const rigs = new Map<string, Rig>();
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // Shared geometry + shared skin/tunic/hat materials across all villagers.
  const rigKit = createRigKit(track);

  // T05: the one shared selection ring.
  const ringGroup = createSelectionRing(track, group);
  let selectedId: string | null = null;
  const scratch = new THREE.Vector3();

  // B6: one shared heart texture and a fixed pool of sprites.
  const hearts = createHeartPool(track, group);
  let heartSerial = 0; // deterministic stagger source; never Math.random
  let lastEventTick = -1; // `state.events` holds one tick's events, so gate on the tick number

  return {
    group,
    update(state: GameState, timeSec: number, dtMs: number): void {
      const dtSec = Math.min(Math.max(dtMs, 0), 100) / 1000;
      // B6: embers is `fuel === 0`; the sim floors fuel there, `<= 0` also survives a bad load.
      const embers = state.fire.fuel <= 0;
      state.villagers.forEach((villager, i) => {
        let rig = rigs.get(villager.id);
        if (!rig) {
          rig = createRig(villager, i, rigKit, group);
          rigs.set(villager.id, rig);
        }
        // The savoring bob belongs to an eating rest only: armed by the `eat` event below and
        // released as soon as the villager leaves `resting`.
        if (villager.state !== 'resting') rig.savoring = false;
        animate(rig, villager, timeSec, dtSec, embers && (villager.state === 'idle' || villager.state === 'resting'));
      });
      const live = new Set(state.villagers.map((v) => v.id));
      for (const [id, rig] of rigs) {
        if (!live.has(id)) {
          group.remove(rig.root);
          rigs.delete(id);
        }
      }
      // B6: one scan per sim tick, not per render pass. `state.events` is cleared and refilled by
      // `tick`, so the tick number is what makes this idempotent — an extra render pass over the
      // same events must not spawn a second set of hearts.
      if (state.tick !== lastEventTick) {
        lastEventTick = state.tick;
        for (const event of state.events) {
          // F4: a completed favor bursts the same pooled hearts as a meal, with the same rules —
          // only the savoring bob stays exclusive to eating.
          const burstsHearts = event.type === 'eat' || event.type === 'favor-done';
          if (!burstsHearts || event.villagerId === undefined) continue;
          const rig = rigs.get(event.villagerId);
          if (!rig) continue;
          if (event.type === 'eat') rig.savoring = true;
          heartSerial = spawnHearts(hearts, rig, heartSerial);
        }
      }
      advanceHearts(hearts, rigs, dtMs, timeSec);
      // The ring trails the selected rig every frame, hidden when nothing is selected (including
      // when the selected id has no rig).
      const picked = selectedId === null ? undefined : rigs.get(selectedId);
      updateSelectionRing(ringGroup, picked, timeSec);
    },
    pick(raycaster: THREE.Raycaster): string | null {
      // Nearest tagged mesh wins. The ring is untagged, so a hit on it is just skipped.
      for (const hit of raycaster.intersectObjects(group.children, true)) {
        const id: unknown = hit.object.userData.villagerId;
        if (typeof id === 'string') return id;
      }
      return null;
    },
    setSelected(villagerId: string | null): void {
      selectedId = villagerId; // applied by the next update(), once a rig exists
    },
    project(villagerId: string, camera: THREE.Camera, out: THREE.Vector2): boolean {
      const rig = rigs.get(villagerId);
      if (!rig) return false;
      rig.root.getWorldPosition(scratch);
      scratch.y += PICK_LIFT;
      scratch.project(camera);
      // z > 1 means the rig is behind the camera, where the xy projection is meaningless.
      if (scratch.z > 1) return false;
      out.set(scratch.x, scratch.y);
      return true;
    },
    dispose(): void {
      disposables.forEach((d) => d.dispose()); // heart texture + materials + geometries
      disposables.length = 0;
      rigKit.clearCache();
      rigs.clear();
      hearts.length = 0; // sprites were children of `group`, dropped by the clear below
      group.clear();
    },
  };
}
