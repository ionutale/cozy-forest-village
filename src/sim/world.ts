// World generation (DESIGN.md §3, T02 brief): one campfire at the origin, then
// 40 trees and 20 bushes scattered in an annulus r = 6…28 via rejection sampling
// (min gap 1.8, 12 tries per node; the last candidate is kept if all tries fail).

import type { ResourceNode } from './types';

const TREE_COUNT = 40;
const BUSH_COUNT = 20;
const TAU = Math.PI * 2;
/** Scatter radii are sampled over squared radius for uniform annulus density. */
const INNER_R2 = 6 * 6;
const OUTER_R2 = 28 * 28;
const MIN_GAP_SQ = 1.8 * 1.8;
const MAX_TRIES = 12;

interface Placed {
  x: number;
  z: number;
}

function isCrowded(taken: ReadonlyArray<Placed>, p: Placed): boolean {
  return taken.some((o) => (o.x - p.x) ** 2 + (o.z - p.z) ** 2 < MIN_GAP_SQ);
}

function scatter(
  kind: 'tree' | 'bush',
  count: number,
  rnd: () => number,
  taken: Placed[],
): ResourceNode[] {
  const nodes: ResourceNode[] = [];
  for (let i = 0; i < count; i += 1) {
    let spot: Placed = { x: 0, z: 0 };
    for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
      const radius = Math.sqrt(INNER_R2 + rnd() * (OUTER_R2 - INNER_R2));
      const angle = rnd() * TAU;
      const candidate: Placed = { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
      spot = candidate;
      if (!isCrowded(taken, candidate)) break;
    }
    taken.push(spot);
    nodes.push({ id: `${kind}-${i + 1}`, kind, pos: { x: spot.x, z: spot.z } });
  }
  return nodes;
}

export function generateWorld(rnd: () => number): ResourceNode[] {
  // The campfire occupies the origin, so scatter avoids it from the start.
  const taken: Placed[] = [{ x: 0, z: 0 }];
  return [
    { id: 'campfire', kind: 'campfire', pos: { x: 0, z: 0 } },
    ...scatter('tree', TREE_COUNT, rnd, taken),
    ...scatter('bush', BUSH_COUNT, rnd, taken),
  ];
}
