// Hearts: the pooled sprite garnish for a meal (B6) — 2–3 tiny sprites per
// meal, ~1 u of lift, gone in ~1.2 s, one shared pool. No allocation per
// meal, and an idle heart is `visible = false`, so it costs nothing but
// memory. The stagger is deterministic (hash01), never Math.random.

import * as THREE from 'three';
import { PALETTE } from '../palette';
import { hash01, type Rig } from './rig';

const TAU = Math.PI * 2;
const HEART_POOL = 4; const HEART_LIFE_MS = 1200; // a burst is 2–3 hearts, the pool is 4
const HEART_Y = 0.72; const HEART_RISE = 1; const HEART_SIZE = 0.19;

export interface Heart {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  active: boolean;
  ageMs: number;
  ownerId: string; // '' once the eater's rig is gone; the heart then stays put
  x: number;
  z: number;
  spread: number; // -1..1 fan around the head
  phase: number;
}

/** The one heart sprite texture: drawn on a canvas at boot, no external assets. */
function heartTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Flower pink as the base tone, lifted half-way towards the warm off-white for the highlight —
    // both keys already in PALETTE, so the garnish stays inside the village's colour story.
    const lit = new THREE.Color(PALETTE.flowerPink).lerp(new THREE.Color(PALETTE.flowerWhite), 0.5);
    ctx.translate(size / 2, size * 0.52);
    ctx.scale(size / 32, size / 32);
    ctx.beginPath();
    ctx.moveTo(0, 11);
    ctx.bezierCurveTo(0, 11, -13, 0, -13, -7);
    ctx.bezierCurveTo(-13, -16, -4, -19, 0, -12);
    ctx.bezierCurveTo(4, -19, 13, -16, 13, -7);
    ctx.bezierCurveTo(13, 0, 0, 11, 0, 11);
    ctx.fillStyle = PALETTE.flowerPink;
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = `#${lit.getHexString()}`;
    ctx.beginPath();
    ctx.ellipse(-5, -6, 2.6, 3.4, -0.4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false; // a sprite is drawn tiny; mips only cost memory
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/** One shared heart texture and a fixed pool of sprites, parented to the layer group. */
export function createHeartPool(
  track: <T extends { dispose(): void }>(item: T) => T,
  parent: THREE.Group,
): Heart[] {
  const heartTex = track(heartTexture());
  const hearts: Heart[] = [];
  for (let i = 0; i < HEART_POOL; i += 1) {
    const material = track(new THREE.SpriteMaterial({ map: heartTex, transparent: true, opacity: 0, depthWrite: false }));
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.renderOrder = 3; // over the village, never occluded by the sprites above it
    parent.add(sprite);
    hearts.push({ sprite, material, active: false, ageMs: 0, ownerId: '', x: 0, z: 0, spread: 0, phase: 0 });
  }
  return hearts;
}

/** A free heart, else the oldest one — the pool is fixed, so a burst never allocates. */
export function heartSlot(hearts: Heart[]): Heart | null {
  let free: Heart | null = null;
  let oldest: Heart | null = null;
  for (const heart of hearts) {
    if (!heart.active) {
      free ??= heart;
      continue;
    }
    if (oldest === null || heart.ageMs > oldest.ageMs) oldest = heart;
  }
  return free ?? oldest;
}

/**
 * B6: 2–3 hearts for one meal, fanned around the head, all deterministic.
 * Returns the advanced serial (the deterministic stagger source).
 */
export function spawnHearts(hearts: Heart[], rig: Rig, serial: number): number {
  const count = 2 + Math.round(hash01(serial, 93)); // 2 or 3
  for (let i = 0; i < count; i += 1) {
    const heart = heartSlot(hearts);
    if (!heart) return serial; // pool exhausted and nothing to recycle (never happens: HEART_POOL > count)
    serial += 1;
    heart.active = true;
    heart.ageMs = 0;
    heart.ownerId = rig.id;
    heart.x = rig.root.position.x;
    heart.z = rig.root.position.z;
    heart.spread = hash01(serial, 94) * 1.6 - 0.8;
    heart.phase = hash01(serial, 95) * TAU;
    heart.sprite.visible = true;
  }
  return serial;
}

/** Advance the pool: lift ~1 u with a decelerating ease, fade in fast and out slow. */
export function advanceHearts(
  hearts: Heart[],
  rigs: ReadonlyMap<string, Rig>,
  dtMs: number,
  timeSec: number,
): void {
  for (const heart of hearts) {
    if (!heart.active) continue;
    heart.ageMs += dtMs;
    const life = heart.ageMs / HEART_LIFE_MS;
    if (life >= 1) {
      heart.active = false;
      heart.sprite.visible = false;
      heart.material.opacity = 0;
      continue;
    }
    const owner = rigs.get(heart.ownerId);
    if (owner) {
      heart.x = owner.root.position.x;
      heart.z = owner.root.position.z;
    }
    const rise = 1 - (1 - life) * (1 - life); // ease-out: the lift decelerates at the top
    const fadeIn = Math.min(1, life / 0.15);
    heart.sprite.position.set(
      heart.x + heart.spread * 0.17 + Math.sin(timeSec * 2.1 + heart.phase) * 0.05,
      HEART_Y + rise * HEART_RISE,
      heart.z - heart.spread * 0.12,
    );
    heart.material.opacity = fadeIn * (1 - life * life);
    heart.sprite.scale.setScalar(HEART_SIZE * (0.65 + 0.35 * fadeIn) * (1 - life * 0.15));
  }
}
