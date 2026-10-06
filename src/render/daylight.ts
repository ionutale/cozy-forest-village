// Daylight pipeline (batch 8, task N3): a pure, canvas-free blend between the shipped day strip and
// a curated twilight strip. No WebGL, no DOM, no clock of its own — just math over the `dayFactor`
// scalar the sim owns, so the whole layer is assertable under vitest's `node` environment (the
// `trader.test.ts` precedent, DESIGN §2/§4).
//
// `daylightFor` does NOT allocate: it fills one module-scope scratch frame and returns it. The
// returned object is therefore the SAME object on every call, and its values are only valid until
// the next call. Callers must consume it immediately (render/index.ts copies the colors into the
// scene in the same frame) — never hold it across frames, never call `daylightFor` twice and expect
// the first result to survive.

import * as THREE from 'three';
import { PALETTE } from './palette';

export interface DaylightFrame {
  sky: THREE.Color;
  fog: THREE.Color;
  ambientSky: THREE.Color;
  ambientGround: THREE.Color;
  ambientIntensity: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  night: number;
}

/**
 * The day strip: the exact values the village has always rendered with (DESIGN §4, `palette.ts`).
 * `dayFactor 1` reproduces them byte-for-byte — the "no noon regression" pin (Review Focus 4).
 */
const DAY = {
  sky: PALETTE.sky,
  fog: PALETTE.fog,
  ambientSky: PALETTE.ambientSky,
  ambientGround: PALETTE.ambientGround,
  ambientIntensity: 0.8,
  sun: PALETTE.sun,
  sunIntensity: 1.6,
} as const;

/**
 * The twilight strip: a muted blue hour, still inside the palette family — no pure black and no
 * channel at an extreme (the guardrail in `daylight.test.ts`). Warm accents are preserved. The exact
 * tones are a curated first pass; the live review may nudge them.
 *
 * The sun sits at `#f6c98f` rather than the spec's `#ffc98f`: the latter's red channel is 255/255,
 * which is outside the (8/255, 247/255) guardrail the spec also requires for every twilight channel.
 */
const TWILIGHT = {
  sky: '#6b7ba8',
  fog: '#828cb0',
  ambientSky: '#7c88b4',
  ambientGround: '#4f5f52',
  ambientIntensity: 0.55,
  sun: '#f6c98f',
  sunIntensity: 0.95,
} as const;

// Keyframe colors, parsed once at module load. Never mutated after this.
const daySky = new THREE.Color(DAY.sky);
const dayFog = new THREE.Color(DAY.fog);
const dayAmbientSky = new THREE.Color(DAY.ambientSky);
const dayAmbientGround = new THREE.Color(DAY.ambientGround);
const daySun = new THREE.Color(DAY.sun);
const twilightSky = new THREE.Color(TWILIGHT.sky);
const twilightFog = new THREE.Color(TWILIGHT.fog);
const twilightAmbientSky = new THREE.Color(TWILIGHT.ambientSky);
const twilightAmbientGround = new THREE.Color(TWILIGHT.ambientGround);
const twilightSun = new THREE.Color(TWILIGHT.sun);

// The single returned scratch frame. Mutated in place by every `daylightFor` call.
const frame: DaylightFrame = {
  sky: new THREE.Color(),
  fog: new THREE.Color(),
  ambientSky: new THREE.Color(),
  ambientGround: new THREE.Color(),
  ambientIntensity: 0,
  sunColor: new THREE.Color(),
  sunIntensity: 0,
  night: 0,
};

/**
 * `out = a` at `t = 0`, `out = b` at `t = 1`, a linear blend between. Endpoints are copied exactly
 * (never lerped) so `dayFactor 1` reproduces the day palette bit-for-bit and `dayFactor 0` the
 * twilight strip — no rounding drift at the seams.
 */
function mixColor(out: THREE.Color, a: THREE.Color, b: THREE.Color, t: number): void {
  if (t <= 0) out.copy(a);
  else if (t >= 1) out.copy(b);
  else out.lerpColors(a, b, t);
}

/** Scalar counterpart of `mixColor`: exact at both endpoints. */
function mix(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return a + (b - a) * t;
}

/**
 * Fills and returns the shared scratch frame for the given `dayFactor` (0 deep night → 1 full day).
 * Allocation-free; the result aliases the module scratch — read it before the next call. A
 * non-finite input is treated as deep night (0), matching the sim's defensive style.
 */
export function daylightFor(dayFactor: number): Readonly<DaylightFrame> {
  const t = Number.isFinite(dayFactor) ? Math.min(1, Math.max(0, dayFactor)) : 0;
  mixColor(frame.sky, twilightSky, daySky, t);
  mixColor(frame.fog, twilightFog, dayFog, t);
  mixColor(frame.ambientSky, twilightAmbientSky, dayAmbientSky, t);
  mixColor(frame.ambientGround, twilightAmbientGround, dayAmbientGround, t);
  mixColor(frame.sunColor, twilightSun, daySun, t);
  frame.ambientIntensity = mix(TWILIGHT.ambientIntensity, DAY.ambientIntensity, t);
  frame.sunIntensity = mix(TWILIGHT.sunIntensity, DAY.sunIntensity, t);
  frame.night = 1 - t;
  return frame;
}
