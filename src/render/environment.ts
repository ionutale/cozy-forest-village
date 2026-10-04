import * as THREE from 'three';
import type { ResourceNode } from '../sim';
import { PALETTE } from './palette';

export interface Environment {
  group: THREE.Group;
  update(timeSec: number): void;
  dispose(): void;
}

const TAU = Math.PI * 2;
const ROCK_COUNT = 24;
const TUFT_COUNT = 420;
const FLOWER_COUNT = 60;
const TRUNK_H = 1.6;

/** Deterministic 0..1 hash from an index + salt. Fully seeded, no RNG calls. */
function hash01(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function scatterRadius(hash: number, inner: number, outer: number): number {
  return Math.sqrt(inner * inner + hash * (outer * outer - inner * inner));
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
  if (campfire) {
    const { x, z } = campfire.pos;
    const ring = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.92, 0.16, 6, 14)),
      track(new THREE.MeshLambertMaterial({ color: PALETTE.rock })),
    );
    ring.position.set(x, 0.14, z);
    ring.rotation.x = -Math.PI / 2;
    ring.castShadow = true;
    const flame = new THREE.Mesh(
      track(new THREE.ConeGeometry(0.4, 1.05, 8)),
      track(new THREE.MeshBasicMaterial({ color: PALETTE.fire })),
    );
    flame.position.set(x, 0.6, z);
    const disc = new THREE.Mesh(
      track(new THREE.CircleGeometry(4.2, 40)),
      track(new THREE.MeshLambertMaterial({ color: '#ece0c3' })),
    );
    disc.position.set(x, 0.01, z);
    disc.rotation.x = -Math.PI / 2;
    disc.receiveShadow = true;
    group.add(disc, ring, flame);
  }

  return {
    group,
    update(timeSec: number): void {
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
