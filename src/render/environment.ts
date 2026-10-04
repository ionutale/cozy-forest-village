import * as THREE from 'three';
import type { Fire, ResourceNode } from '../sim';
import { PALETTE } from './palette';

export interface Environment {
  group: THREE.Group;
  /** B4: optional live fire state; when omitted, fuel is read via the `__cozy` hook
      (render/index.ts still calls `update(timeSec)` and is owned by another task). */
  update(timeSec: number, fire?: Fire): void;
  dispose(): void;
}

const TAU = Math.PI * 2;
const ROCK_COUNT = 24;
const TUFT_COUNT = 420;
const FLOWER_COUNT = 60;
const TRUNK_H = 1.6;
const EMBER_COUNT = 16;
const FLAME_BASE_Y = 0.075; // cone base stays in the ring while the tip breathes

/** Deterministic 0..1 hash from an index + salt. Fully seeded, no RNG calls. */
function hash01(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function scatterRadius(hash: number, inner: number, outer: number): number {
  return Math.sqrt(inner * inner + hash * (outer * outer - inner * inner));
}

/** Live fire state: explicit arg wins, else the `__cozy` hook, else a steady default
    (hook absent in unit tests / before boot). Never throws, never NaN. */
function resolveFire(fire: Fire | undefined): { ratio: number } {
  const hookFire = typeof window === 'undefined' ? undefined : window.__cozy?.getState().fire;
  const f = fire ?? hookFire ?? { fuel: 70, max: 100 };
  if (!(f.max > 0)) return { ratio: 0.7 };
  const ratio = f.fuel / f.max;
  return { ratio: Math.min(1, Math.max(0, ratio)) };
}

export function createEnvironment(nodes: readonly ResourceNode[]): Environment {
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  const colorA = new THREE.Color();
  const colorB = new THREE.Color();
  const mixed = new THREE.Color();
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const trees = nodes.filter((n) => n.kind === 'tree');
  const bushes = nodes.filter((n) => n.kind === 'bush');
  const campfire = nodes.find((n) => n.kind === 'campfire');

  // --- Trees: one instanced trunk + one instanced crown ---
  const trunkGeo = track(new THREE.CylinderGeometry(0.26, 0.36, TRUNK_H, 7));
  const trunkMat = track(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(trees.length, 1));
  const crownGeo = track(new THREE.ConeGeometry(1.15, 2.7, 8));
  const crownMat = track(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, Math.max(trees.length, 1));
  // T6 breeze: per-crown sway state (base pose + slow 0.6–1.0 Hz phase); trunks stay put.
  const crownBase: Array<{ x: number; y: number; z: number; rot: number; s: number; phase: number; freq: number }> = [];
  trunks.castShadow = true;
  crowns.castShadow = true;
  colorA.set(PALETTE.trunk);
  trees.forEach((node, i) => {
    const rot = hash01(i, 1) * TAU;
    const s = 0.9 + hash01(i, 2) * 0.25;
    dummy.position.set(node.pos.x, (TRUNK_H * s) / 2, node.pos.z);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    // Subtle per-trunk brightness variation around the trunk tone.
    mixed.copy(colorA).multiplyScalar(0.94 + hash01(i, 3) * 0.12);
    trunks.setColorAt(i, mixed);
    const cs = 0.88 + hash01(i, 4) * 0.24; // crown scale within ±12%
    dummy.position.set(node.pos.x, TRUNK_H * s + 1.15 * cs, node.pos.z);
    dummy.rotation.set(0, rot + 0.6, 0);
    dummy.scale.setScalar(cs);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
    crownBase.push({
      x: node.pos.x, y: TRUNK_H * s + 1.15 * cs, z: node.pos.z, rot: rot + 0.6, s: cs,
      phase: hash01(i, 23) * TAU, freq: 0.6 + hash01(i, 24) * 0.4,
    });
  });
  colorA.set(PALETTE.foliageA);
  colorB.set(PALETTE.foliageB);
  trees.forEach((_, i) => {
    mixed.lerpColors(colorA, colorB, hash01(i, 5));
    crowns.setColorAt(i, mixed);
  });
  trunks.count = trees.length;
  crowns.count = trees.length;
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  group.add(trunks, crowns);

  // --- Bushes: one instanced mesh of squashed spheres ---
  const bushGeo = track(new THREE.SphereGeometry(0.55, 10, 7));
  const bushMat = track(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
  const bushMesh = new THREE.InstancedMesh(bushGeo, bushMat, Math.max(bushes.length, 1));
  bushMesh.castShadow = true;
  bushes.forEach((node, i) => {
    const s = 0.85 + hash01(i, 6) * 0.4;
    dummy.position.set(node.pos.x, 0.4 * s, node.pos.z);
    dummy.rotation.set(0, hash01(i, 7) * TAU, 0);
    dummy.scale.set(s, 0.72 * s, s);
    dummy.updateMatrix();
    bushMesh.setMatrixAt(i, dummy.matrix);
    mixed.lerpColors(colorA, colorB, hash01(i, 8));
    bushMesh.setColorAt(i, mixed);
  });
  bushMesh.count = bushes.length;
  bushMesh.instanceMatrix.needsUpdate = true;
  if (bushMesh.instanceColor) bushMesh.instanceColor.needsUpdate = true;
  group.add(bushMesh);

  // --- Rocks: 24 flat-shaded, deterministic r=7..30 ---
  const rockGeo = track(new THREE.DodecahedronGeometry(0.5, 0));
  const rockMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.rock, flatShading: true }));
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_COUNT);
  for (let i = 0; i < ROCK_COUNT; i += 1) {
    const r = 7 + hash01(i, 9) * 23;
    const a = hash01(i, 10) * TAU;
    const s = 0.5 + hash01(i, 11) * 1.1;
    dummy.position.set(Math.cos(a) * r, 0.12 * s, Math.sin(a) * r);
    dummy.rotation.set(0, hash01(i, 12) * TAU, 0);
    dummy.scale.set(s, s * 0.55, s * (0.7 + hash01(i, 13) * 0.4));
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  rocks.instanceMatrix.needsUpdate = true;
  group.add(rocks);

  // --- Grass tufts: 420 small cones inside r=34 ---
  const tuftGeo = track(new THREE.ConeGeometry(0.09, 0.5, 5));
  const tuftMat = track(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, TUFT_COUNT);
  colorA.set(PALETTE.tuftA);
  colorB.set(PALETTE.tuftB);
  for (let i = 0; i < TUFT_COUNT; i += 1) {
    const r = scatterRadius(hash01(i, 14), 1.5, 34);
    const a = hash01(i, 15) * TAU;
    const s = 0.6 + hash01(i, 16) * 0.4;
    dummy.position.set(Math.cos(a) * r, 0.16 * s, Math.sin(a) * r);
    dummy.rotation.set(0, hash01(i, 17) * TAU, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    tufts.setMatrixAt(i, dummy.matrix);
    mixed.lerpColors(colorA, colorB, hash01(i, 18));
    tufts.setColorAt(i, mixed);
  }
  tufts.instanceMatrix.needsUpdate = true;
  if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
  group.add(tufts);

  // --- Wildflowers: 60 tiny spheres inside r=4..30 ---
  const flowerGeo = track(new THREE.SphereGeometry(0.09, 6, 5));
  const flowerMat = track(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, FLOWER_COUNT);
  colorA.set(PALETTE.flowerWhite);
  colorB.set(PALETTE.flowerPink);
  for (let i = 0; i < FLOWER_COUNT; i += 1) {
    const r = scatterRadius(hash01(i, 19), 4, 30);
    const a = hash01(i, 20) * TAU;
    dummy.position.set(Math.cos(a) * r, 0.12, Math.sin(a) * r);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(0.7 + hash01(i, 21) * 0.6);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
    mixed.lerpColors(colorA, colorB, hash01(i, 22));
    flowers.setColorAt(i, mixed);
  }
  flowers.instanceMatrix.needsUpdate = true;
  if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
  group.add(flowers);

  // --- Campfire area: ring + flame (T1 look) + warm clearing disc ---
  // B4: the flame, its light and the ember bed all breathe with `state.fire.fuel`.
  let flame: THREE.Mesh | null = null;
  let flameMat: THREE.MeshBasicMaterial | null = null;
  let fireLight: THREE.PointLight | null = null;
  let emberMat: THREE.PointsMaterial | null = null;
  let fireX = 0;
  let fireZ = 0;
  const fireCol = new THREE.Color(PALETTE.fire);
  const emberCol = new THREE.Color(PALETTE.ember);
  if (campfire) {
    const { x, z } = campfire.pos;
    fireX = x;
    fireZ = z;
    const ring = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.92, 0.16, 6, 14)),
      track(new THREE.MeshLambertMaterial({ color: PALETTE.rock })),
    );
    ring.position.set(x, 0.14, z);
    ring.rotation.x = -Math.PI / 2;
    ring.castShadow = true;
    flameMat = track(new THREE.MeshBasicMaterial({ color: PALETTE.fire }));
    flame = new THREE.Mesh(track(new THREE.ConeGeometry(0.4, 1.05, 8)), flameMat);
    flame.position.set(x, 0.6, z);
    const disc = new THREE.Mesh(
      track(new THREE.CircleGeometry(4.2, 40)),
      track(new THREE.MeshLambertMaterial({ color: PALETTE.disc })),
    );
    disc.position.set(x, 0.01, z);
    disc.rotation.x = -Math.PI / 2;
    disc.receiveShadow = true;
    // One warm point light, no shadows (perf); intensity follows fuel in update().
    fireLight = new THREE.PointLight(PALETTE.fire, 1.4, 14, 2);
    fireLight.position.set(x, 1.1, z);
    // Ember bed: 16 dim dots over the ring; opacity follows 1 − fuel in update().
    const emberGeo = track(new THREE.BufferGeometry());
    const emberPos = new Float32Array(EMBER_COUNT * 3);
    for (let i = 0; i < EMBER_COUNT; i += 1) {
      const r = Math.sqrt(hash01(i, 25)) * 0.8;
      const a = hash01(i, 26) * TAU;
      emberPos[i * 3] = x + Math.cos(a) * r;
      emberPos[i * 3 + 1] = 0.1 + hash01(i, 27) * 0.45;
      emberPos[i * 3 + 2] = z + Math.sin(a) * r;
    }
    emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
    emberMat = track(new THREE.PointsMaterial({
      color: PALETTE.ember, size: 0.09, transparent: true, opacity: 0.8, depthWrite: false,
    }));
    const embers = new THREE.Points(emberGeo, emberMat);
    embers.frustumCulled = false;
    group.add(disc, ring, flame, fireLight, embers);
  }

  return {
    group,
    update(timeSec: number, fire?: Fire): void {
      // T6 breeze: crowns tilt ≤ 0.03 rad around their base; trunks stay put. 40 crowns: trivial.
      for (let i = 0; i < crownBase.length; i += 1) {
        const c = crownBase[i]!; // guarded by the loop bound (same idiom as sim/index.ts)
        const tilt = Math.sin(timeSec * TAU * c.freq + c.phase) * 0.03;
        const tilt2 = Math.cos(timeSec * TAU * c.freq * 0.83 + c.phase * 1.7) * 0.03;
        dummy.position.set(c.x, c.y, c.z);
        dummy.rotation.set(tilt, c.rot, tilt2);
        dummy.scale.setScalar(c.s);
        dummy.updateMatrix();
        crowns.setMatrixAt(i, dummy.matrix);
      }
      if (crownBase.length > 0) crowns.instanceMatrix.needsUpdate = true;
      // B4 heartbeat: flame scale/tint, warm light and ember glow all follow fuel.
      // Slow two-sine flicker (±6 %), always eased — never strobing.
      if (flame && flameMat && fireLight && emberMat) {
        const { ratio } = resolveFire(fire);
        const flick = 0.6 * Math.sin(timeSec * TAU * 0.9) + 0.4 * Math.sin(timeSec * TAU * 1.7 + 1.3);
        const s = (0.25 + 0.75 * ratio) * (1 + 0.06 * flick);
        flame.scale.setScalar(s);
        flame.position.set(
          fireX + 0.03 * Math.sin(timeSec * TAU * 1.3 + 0.5),
          FLAME_BASE_Y + 0.525 * s,
          fireZ + 0.03 * Math.cos(timeSec * TAU * 1.1 + 2.0),
        );
        flameMat.color.lerpColors(emberCol, fireCol, ratio);
        fireLight.intensity = (0.25 + 1.15 * ratio) * (1 + 0.06 * flick);
        emberMat.opacity = (0.15 + 0.75 * (1 - ratio)) * (1 + 0.1 * flick);
      }
    },
    dispose(): void {
      group.traverse((obj) => {
        if (obj instanceof THREE.InstancedMesh) obj.dispose();
      });
      disposables.forEach((d) => d.dispose());
      group.clear();
    },
  };
}
