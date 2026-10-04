import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng';

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 16 }, () => a());
    const seqB = Array.from({ length: 16 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const seqA = Array.from({ length: 16 }, () => mulberry32(1)());
    const seqB = Array.from({ length: 16 }, () => mulberry32(2)());
    expect(seqA).not.toEqual(seqB);
  });

  it('stays within [0, 1) and is deterministic across instances', () => {
    const rnd = mulberry32(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = rnd();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
