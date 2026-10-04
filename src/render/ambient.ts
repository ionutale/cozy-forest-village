// Ambient life: birds, butterflies and drifting motes (DESIGN §2 pillars 3–4 — sparing, gentle).
// Deterministic hash-derived phases throughout; no Math.random. Draw calls: 3 (birds) + 3
// (butterflies) + 1 (motes).

import * as THREE from 'three';
import type { GameState } from '../sim';
import { PALETTE } from './palette';

export interface AmbientLayer {
  group: THREE.Group;
  update(state: GameState, timeSec: number, dtMs: number): void;
  dispose(): void;
}

const TAU = Math.PI * 2;
const BIRD_COUNT = 6;
const FLY_COUNT = 8;
const MOTE_COUNT = 60;

interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
  flap: number;
}

/** Deterministic 0..1 hash — no RNG, no state. */
function hash01(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Bird i on its wide slow circle: radius 9–16, height 7–12, 0.05–0.09 rad/s, ±0.35 rad flap at ~3 Hz. */
function birdPose(i: number, t: number, out: Pose): void {
  const r = 9 + hash01(i, 31) * 7;
  const h = 7 + hash01(i, 32) * 5;
  const speed = 0.05 + hash01(i, 33) * 0.04;
  const dir = hash01(i, 34) < 0.5 ? 1 : -1;
  const a = hash01(i, 35) * TAU + dir * speed * t;
  const phase = hash01(i, 36) * TAU;
  out.x = Math.cos(a) * r;
  out.y = h + Math.sin(t * 0.7 + phase) * 0.5;
  out.z = Math.sin(a) * r;
  out.heading = Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir);
  out.flap = Math.sin(t * TAU * 3 + phase) * 0.35;
}

/** Butterfly i on a slow lissajous wander (≤ ~0.36 u/s), y 0.4–1.4, tiny ±0.45 rad flutter at ~7 Hz. */
function flyPose(i: number, t: number, out: Pose): void {
  const ca = hash01(i, 41) * TAU;
  const cr = hash01(i, 42) * 6;
  const cx = Math.cos(ca) * cr;
  const cz = Math.sin(ca) * cr;
  const baseY = 0.4 + hash01(i, 43) * 1.0;
  const ax = 0.8 + hash01(i, 44) * 0.8;
  const az = 0.8 + hash01(i, 45) * 0.8;
  const wx = 0.1 + hash01(i, 46) * 0.06;
  const wz = 0.1 + hash01(i, 47) * 0.06;
  const p1 = hash01(i, 48) * TAU;
  const p2 = hash01(i, 49) * TAU;
  const p3 = hash01(i, 50) * TAU;
  out.x = cx + ax * Math.sin(wx * t + p1);
  out.z = cz + az * Math.sin(wz * t + p2);
  out.y = baseY + 0.25 * Math.sin(0.5 * (wx + wz) * t + p3);
  out.flap = Math.sin(t * TAU * 7 + p1) * 0.45;
  // Heading from a short look-ahead so the wings lead the curve.
  const nx = cx + ax * Math.sin(wx * (t + 0.15) + p1);
  const nz = cz + az * Math.sin(wz * (t + 0.15) + p2);
  out.heading = Math.atan2(nx - out.x, nz - out.z);
}

export function createAmbient(): AmbientLayer {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };
  const mRoot = new THREE.Matrix4();
  const mPart = new THREE.Matrix4();
  const scratch: Pose = { x: 0, y: 0, z: 0, heading: 0, flap: 0 };

  /** Wing local matrix (root offset + flap about the forward axis) under the current mRoot. */
  function setWing(mesh: THREE.InstancedMesh, i: number, ox: number, flap: number): void {
    mPart.makeRotationZ(flap);
    mPart.setPosition(ox, 0.06, -0.05);
    mPart.premultiply(mRoot);
    mesh.setMatrixAt(i, mPart);
  }

  // --- Birds: one instanced body + two instanced wings (left/right) = 3 draw calls ---
  const birdMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.bird, side: THREE.DoubleSide }));
  const bodyGeo = track(new THREE.ConeGeometry(0.13, 0.6, 6));
  bodyGeo.rotateX(Math.PI / 2); // tip forward (+Z) so heading matches the villager convention
  const bodies = new THREE.InstancedMesh(bodyGeo, birdMat, BIRD_COUNT);
  function birdWingGeo(side: 1 | -1): THREE.PlaneGeometry {
    const geo = new THREE.PlaneGeometry(0.62, 0.3);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0.31 * side, 0, 0);
    return track(geo);
  }
  const wingR = new THREE.InstancedMesh(birdWingGeo(1), birdMat, BIRD_COUNT);
  const wingL = new THREE.InstancedMesh(birdWingGeo(-1), birdMat, BIRD_COUNT);
  bodies.frustumCulled = false;
  wingR.frustumCulled = false;
  wingL.frustumCulled = false;
  group.add(bodies, wingR, wingL);

  // --- Butterflies: two instanced wings (white/pink mix) + one instanced body = 3 draw calls ---
  const flyMat = track(new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
  function flyWingGeo(side: 1 | -1): THREE.PlaneGeometry {
    const geo = new THREE.PlaneGeometry(0.16, 0.13);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0.08 * side, 0, 0);
    return track(geo);
  }
  const flyR = new THREE.InstancedMesh(flyWingGeo(1), flyMat, FLY_COUNT);
  const flyL = new THREE.InstancedMesh(flyWingGeo(-1), flyMat, FLY_COUNT);
  const flyBodyGeo = track(new THREE.SphereGeometry(0.035, 6, 5));
  flyBodyGeo.scale(1, 1, 2.2);
  const flyBodies = new THREE.InstancedMesh(
    flyBodyGeo,
    track(new THREE.MeshLambertMaterial({ color: PALETTE.trunk })),
    FLY_COUNT,
  );
  const flyWhite = new THREE.Color(PALETTE.flowerWhite);
  const flyPink = new THREE.Color(PALETTE.flowerPink);
  const flyMixed = new THREE.Color();
  for (let i = 0; i < FLY_COUNT; i += 1) {
    flyMixed.lerpColors(flyWhite, flyPink, hash01(i, 61));
    flyR.setColorAt(i, flyMixed);
    flyL.setColorAt(i, flyMixed);
  }
  if (flyR.instanceColor) flyR.instanceColor.needsUpdate = true;
  if (flyL.instanceColor) flyL.instanceColor.needsUpdate = true;
  flyR.frustumCulled = false;
  flyL.frustumCulled = false;
  flyBodies.frustumCulled = false;
  group.add(flyR, flyL, flyBodies);

  // --- Motes: one THREE.Points of 60 soft drifting specks inside r=20 = 1 draw call ---
  const moteBase = new Float32Array(MOTE_COUNT * 3);
  const motePhase = new Float32Array(MOTE_COUNT * 3);
  const motePos = new Float32Array(MOTE_COUNT * 3);
  for (let i = 0; i < MOTE_COUNT; i += 1) {
    const r = Math.sqrt(hash01(i, 70)) * 20;
    const a = hash01(i, 71) * TAU;
    moteBase[i * 3] = Math.cos(a) * r;
    moteBase[i * 3 + 1] = 0.3 + hash01(i, 72) * 5;
    moteBase[i * 3 + 2] = Math.sin(a) * r;
    motePhase[i * 3] = hash01(i, 73) * TAU;
    motePhase[i * 3 + 1] = hash01(i, 74) * TAU;
    motePhase[i * 3 + 2] = hash01(i, 75) * TAU;
  }
  const moteGeo = track(new THREE.BufferGeometry());
  const moteAttr = new THREE.BufferAttribute(motePos, 3);
  moteGeo.setAttribute('position', moteAttr);
  const motes = new THREE.Points(
    moteGeo,
    track(new THREE.PointsMaterial({
      color: PALETTE.mote, size: 0.16, transparent: true, opacity: 0.5, depthWrite: false,
    })),
  );
  motes.frustumCulled = false;
  group.add(motes);

  return {
    group,
    update(_state: GameState, timeSec: number, _dtMs: number): void {
      for (let i = 0; i < BIRD_COUNT; i += 1) {
        birdPose(i, timeSec, scratch);
        mRoot.makeRotationY(scratch.heading);
        mRoot.setPosition(scratch.x, scratch.y, scratch.z);
        bodies.setMatrixAt(i, mRoot);
        setWing(wingR, i, 0.08, scratch.flap);
        setWing(wingL, i, -0.08, -scratch.flap);
      }
      bodies.instanceMatrix.needsUpdate = true;
      wingR.instanceMatrix.needsUpdate = true;
      wingL.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < FLY_COUNT; i += 1) {
        flyPose(i, timeSec, scratch);
        mRoot.makeRotationY(scratch.heading);
        mRoot.setPosition(scratch.x, scratch.y, scratch.z);
        flyBodies.setMatrixAt(i, mRoot);
        setWing(flyR, i, 0.02, scratch.flap);
        setWing(flyL, i, -0.02, -scratch.flap);
      }
      flyBodies.instanceMatrix.needsUpdate = true;
      flyR.instanceMatrix.needsUpdate = true;
      flyL.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < MOTE_COUNT; i += 1) {
        const o = i * 3;
        motePos[o] = (moteBase[o] ?? 0) + Math.sin(timeSec * 0.12 + (motePhase[o] ?? 0)) * 1.4;
        motePos[o + 1] = (moteBase[o + 1] ?? 0) + Math.sin(timeSec * 0.09 + (motePhase[o + 1] ?? 0)) * 0.8;
        motePos[o + 2] = (moteBase[o + 2] ?? 0) + Math.cos(timeSec * 0.1 + (motePhase[o + 2] ?? 0)) * 1.4;
      }
      moteAttr.needsUpdate = true;
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
