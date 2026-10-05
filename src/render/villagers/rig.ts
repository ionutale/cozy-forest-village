// Villager rig construction: the shared geometry/material kit plus the
// per-villager rig — primitive characters from shared geometry (DESIGN §2
// pillar 2 — big head, small body, hat as the identity cue). T05: every mesh
// is tagged so a ray hit resolves to a villager id. All smoothing state lives
// on the rig, so the sim stays pure (DESIGN §3).

import * as THREE from 'three';
import type { Villager } from '../../sim';
import { PALETTE } from '../palette';

const TAU = Math.PI * 2;
const BODY_Y = 0.25; export const HEAD_Y = 0.6; const HAT_Y = 0.81; const POM_Y = 0.92; // ~0.97u villager
const SHOULDER_Y = 0.44; const ARM_X = 0.185; const ARM_DROP = 0.09; // capsule is 0.18u long
const LOG_Y = 0.42; const LOG_Z = 0.2; // held-log rest position in body-local space

/** Deterministic 0..1 hash — no RNG, no state. */
export function hash01(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export interface Rig {
  id: string;
  root: THREE.Group;
  body: THREE.Group; // bob (position.y) + work lean (rotation.x)
  head: THREE.Group; // savoring bob rides on the head, never the whole body
  armL: THREE.Group;
  armR: THREE.Group;
  log: THREE.Mesh; // the carried log; hidden and unscaled unless `carrying`
  facing: number;
  phase: number; // per-villager offset so nobody animates in lockstep
  bob: number;
  lean: number;
  swing: number;
  raise: number;
  stir: number;
  carry: number; // 0..1 eased carry blend — drives the log's scale and visibility
  chill: number; // 0..1 eased embers shiver blend
  savor: number; // 0..1 eased savoring-bob blend
  savoring: boolean; // armed by an `eat` event, cleared when that rest ends
}

/**
 * The geometries and materials shared by every villager, built once per layer
 * and disposed through the layer's disposables. One hat material pair per
 * distinct hat color, reused by cone + pom.
 */
export interface RigKit {
  bodyGeo: THREE.SphereGeometry;
  headGeo: THREE.SphereGeometry;
  hatGeo: THREE.ConeGeometry;
  pomGeo: THREE.SphereGeometry;
  armGeo: THREE.CapsuleGeometry;
  /** B6: the held log, pre-rotated onto the x axis so it lies across the body. */
  logGeo: THREE.CylinderGeometry;
  tunicMat: THREE.MeshLambertMaterial;
  skinMat: THREE.MeshLambertMaterial;
  logMat: THREE.MeshLambertMaterial;
  hatMaterials(hatColor: string): { cone: THREE.MeshLambertMaterial; pom: THREE.MeshLambertMaterial };
  /** Drop the cached hat materials; their disposal rides the shared disposables. */
  clearCache(): void;
}

export function createRigKit(
  track: <T extends { dispose(): void }>(item: T) => T,
): RigKit {
  // Shared geometry + shared skin/tunic materials across all villagers.
  const bodyGeo = track(new THREE.SphereGeometry(0.17, 12, 8));
  const headGeo = track(new THREE.SphereGeometry(0.15, 14, 10));
  const hatGeo = track(new THREE.ConeGeometry(0.17, 0.2, 10));
  const pomGeo = track(new THREE.SphereGeometry(0.05, 8, 6));
  const armGeo = track(new THREE.CapsuleGeometry(0.045, 0.09, 3, 8));
  // B6: the held log, pre-rotated so it lies across the body (x axis) and can be
  // scaled from its own centre when the carry pose eases in and out.
  const logGeo = track(new THREE.CylinderGeometry(0.05, 0.052, 0.44, 8));
  logGeo.rotateZ(Math.PI / 2);
  const tunicMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.tunic }));
  const skinMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.skin }));
  const logMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.trunk }));

  // One hat material pair per distinct hat color, reused by cone + pom.
  const hatMats = new Map<string, { cone: THREE.MeshLambertMaterial; pom: THREE.MeshLambertMaterial }>();
  function hatMaterials(hatColor: string): { cone: THREE.MeshLambertMaterial; pom: THREE.MeshLambertMaterial } {
    const cached = hatMats.get(hatColor);
    if (cached) return cached;
    const made = {
      cone: track(new THREE.MeshLambertMaterial({ color: hatColor })),
      pom: track(new THREE.MeshLambertMaterial({ color: new THREE.Color(hatColor).multiplyScalar(0.8) })),
    };
    hatMats.set(hatColor, made);
    return made;
  }

  return {
    bodyGeo,
    headGeo,
    hatGeo,
    pomGeo,
    armGeo,
    logGeo,
    tunicMat,
    skinMat,
    logMat,
    hatMaterials,
    clearCache: () => hatMats.clear(),
  };
}

/** One arm on a shoulder pivot; `side` is -1 (left) or +1 (right). */
function armPivot(side: number, kit: RigKit): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(ARM_X * side, SHOULDER_Y, 0);
  const mesh = new THREE.Mesh(kit.armGeo, kit.skinMat);
  mesh.position.y = -ARM_DROP;
  pivot.add(mesh);
  return pivot;
}

export function createRig(
  villager: Villager,
  index: number,
  kit: RigKit,
  group: THREE.Group,
): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Mesh(kit.bodyGeo, kit.tunicMat);
  torso.position.y = BODY_Y;
  torso.scale.set(1, 1.45, 1);
  // Shadow casters are the torso and head only (M10): letting arms, hat and pom cast too
  // cost ~32 shadow draws for a silhouette difference nobody can see at play distance.
  torso.castShadow = true;
  body.add(torso);
  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  const face = new THREE.Mesh(kit.headGeo, kit.skinMat);
  face.castShadow = true;
  head.add(face);
  const mats = kit.hatMaterials(villager.hatColor);
  const hat = new THREE.Mesh(kit.hatGeo, mats.cone);
  hat.position.y = HAT_Y - HEAD_Y;
  const pom = new THREE.Mesh(kit.pomGeo, mats.pom);
  pom.position.y = POM_Y - HEAD_Y;
  head.add(hat, pom);
  body.add(head);
  const armL = armPivot(-1, kit);
  const armR = armPivot(1, kit);
  body.add(armL, armR);
  // B6: the log is a child of `body`, so the carry lean tips it with the villager. It starts
  // hidden at zero scale — the carry blend is what brings it in, so nothing pops on deposit.
  const log = new THREE.Mesh(kit.logGeo, kit.logMat);
  log.position.set(0, LOG_Y, LOG_Z);
  log.rotation.y = 0.28; // angled across the chest rather than bolted to the front
  log.visible = false;
  body.add(log);
  // T05: tag every mesh so a raycast hit resolves back to the villager it belongs to.
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.userData.villagerId = villager.id;
  });
  root.position.set(villager.pos.x, 0, villager.pos.z);
  root.rotation.y = villager.facing;
  group.add(root);
  return {
    id: villager.id,
    root,
    body,
    head,
    armL,
    armR,
    log,
    facing: villager.facing,
    phase: hash01(index, 71) * TAU,
    bob: 0,
    lean: 0,
    swing: 0,
    raise: 0,
    stir: 0,
    carry: 0,
    chill: 0,
    savor: 0,
    savoring: false,
  };
}
