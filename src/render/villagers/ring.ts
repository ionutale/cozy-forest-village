// T05 selection ring: one shared soft ring marks the selected villager —
// two tones so it reads at a glance on both the grass and the tan clearing
// disc: a soft warm-white halo underneath, a thin accent ring on top.
// Rounded and translucent, never a hard UI outline (pillars 1 and 4).
// PALETTE.accent is the 3D mirror of --accent and PALETTE.flowerWhite the
// warm off-white standing in for --paper.

import * as THREE from 'three';
import { PALETTE } from '../palette';
import type { Rig } from './rig';

const TAU = Math.PI * 2;
const RING_Y = 0.015; // above the grass (y 0) and the clearing disc (y 0.01): no z-fighting

export function createSelectionRing(
  track: <T extends { dispose(): void }>(item: T) => T,
  parent: THREE.Group,
): THREE.Group {
  const ringGroup = new THREE.Group();
  const halo = new THREE.Mesh(
    track(new THREE.RingGeometry(0.28, 0.37, 48)),
    track(new THREE.MeshBasicMaterial({ color: PALETTE.flowerWhite, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide })),
  );
  const accent = new THREE.Mesh(
    track(new THREE.RingGeometry(0.31, 0.345, 48)),
    track(new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide })),
  );
  halo.rotation.x = accent.rotation.x = -Math.PI / 2; // flat on the ground
  halo.renderOrder = 1;
  accent.renderOrder = 2; // the halo can never win a transparent sort against it
  ringGroup.add(halo, accent);
  ringGroup.visible = false;
  parent.add(ringGroup);
  return ringGroup;
}

/**
 * The ring trails the selected rig every frame, hidden when nothing is selected
 * (including when the selected id has no rig). Its cosine breath runs
 * 1.0 → 1.08 → 1.0 over 1.2 s, easing at both ends so it never snaps.
 */
export function updateSelectionRing(
  ringGroup: THREE.Group,
  picked: Rig | undefined,
  timeSec: number,
): void {
  ringGroup.visible = picked !== undefined;
  if (picked) {
    ringGroup.position.set(picked.root.position.x, RING_Y, picked.root.position.z);
    ringGroup.scale.setScalar(1 + (1 - Math.cos((timeSec * TAU) / 1.2)) * 0.04);
  }
}
