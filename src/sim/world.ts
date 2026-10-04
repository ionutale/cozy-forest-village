// World generation (DESIGN.md §3, §3.2): one campfire at the origin, then
// 40 trees and 20 bushes scattered in an annulus r = 7.5…28 via rejection
// sampling (min gap 2.5, 12 tries per node; the last candidate is kept if all
// tries fail). The inner radius moved out from 6 to 7.5 so the village ring
// (structures at r = 5.2) stays clear of trees; the radial distribution is
// uniform-in-radius (not squared) so the inner edge stays populated.

import type { ResourceNode } from './types';

const TREE_COUNT = 40;
const BUSH_COUNT = 20;
const TAU = Math.PI * 2;
/** Inner/outer scatter radii (DESIGN.md §3.2: from r = 7.5 outward). */
const INNER_R = 7.5;
const OUTER_R = 28;
const MIN_GAP_SQ = 2.5 * 2.5;
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
      // Uniform in radius (not squared): more trees near the inner edge, so
      // every villager's angular sector has a nearby tree and the nearest-tree
      // assignment stays distinct (DESIGN.md §3.1 no-stacking invariant).
      const radius = INNER_R + rnd() * (OUTER_R - INNER_R);
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
