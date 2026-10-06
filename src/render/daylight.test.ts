// The pure-light half of the render layer's batch-8 tests (N3). No WebGL, no canvas, no DOM: this
// only exercises the keyframe blend, so it runs under vitest's `node` environment. The assertions
// are the three Review Focus 4 pins — noon exactness, twilight guardrails, monotonic interpolation.
//
// `daylightFor` returns a shared scratch frame, so every assertion reads its values (hex string,
// channel, or derived scalar) immediately after the call, before the next call mutates the scratch.

import { describe, expect, it } from 'vitest';
import { PALETTE } from './palette';
import { daylightFor } from './daylight';

/** Rec. 709 relative luminance over a color's channels (three's color-managed linear values). */
function luminance(c: { r: number; g: number; b: number }): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

describe('daylightFor — day strip exactness (no noon regression)', () => {
  it('at dayFactor 1 matches the shipped day palette exactly', () => {
    const f = daylightFor(1);
    expect(f.sky.getHexString()).toBe(PALETTE.sky.slice(1)); // #cfe0ea
    expect(f.fog.getHexString()).toBe(PALETTE.fog.slice(1)); // #d8e4cf
    expect(f.ambientSky.getHexString()).toBe(PALETTE.ambientSky.slice(1));
    expect(f.ambientGround.getHexString()).toBe(PALETTE.ambientGround.slice(1));
    expect(f.sunColor.getHexString()).toBe(PALETTE.sun.slice(1));
    expect(f.ambientIntensity).toBe(0.8);
    expect(f.sunIntensity).toBe(1.6);
    expect(f.night).toBe(0);
  });
});

describe('daylightFor — twilight guardrails', () => {
  it('respects the guardrails (no pure black/white, muted)', () => {
    const f = daylightFor(0);
    for (const c of [f.sky, f.fog, f.ambientSky, f.ambientGround, f.sunColor]) {
      for (const ch of [c.r, c.g, c.b]) {
        expect(ch).toBeGreaterThan(8 / 255);
        expect(ch).toBeLessThan(247 / 255);
      }
    }
    expect(f.night).toBe(1);
  });
});

describe('daylightFor — monotonic blend', () => {
  it('sky-family luminance descends day > mid > twilight', () => {
    // Read each frame's numbers into a fresh plain object immediately, since the scratch aliases.
    const sample = (dayFactor: number) => {
      const f = daylightFor(dayFactor);
      return { sky: luminance(f.sky), fog: luminance(f.fog), ambientSky: luminance(f.ambientSky) };
    };
    const day = sample(1);
    const mid = sample(0.5);
    const twilight = sample(0);
    for (const key of ['sky', 'fog', 'ambientSky'] as const) {
      expect(day[key]).toBeGreaterThan(mid[key]);
      expect(mid[key]).toBeGreaterThan(twilight[key]);
    }
  });
});
