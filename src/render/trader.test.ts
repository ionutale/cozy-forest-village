// The first render-layer test (M5). No WebGL, no canvas, no DOM: `createTrader()` builds plain
// three.js geometry and materials, and `Raycaster` is pure math over that graph, so the whole layer
// is assertable under vitest's `node` environment.
//
// What it pins is the class of defect this layer shipped once already: a scene-graph omission
// (`group.add(root)` missing) that left the trader invisible and unpickable while `tsc`, `build` and
// the whole suite stayed green. These are the load-bearing assumptions from the review's M5 table,
// turned into assertions that fail loudly instead of silently:
//
//   · the rig is really in `group`'s graph           → a ray at the stall hits while visiting
//   · `group.visible` really gates `pick()`          → the same ray misses while away
//   · position is a live function of `visitMs`       → the edge ray hits at 0 ms and misses later
//
// The stall is r = 4.2 at 300° and the edge spawn is `EDGE_SPAWN`, both private to `trader.ts`, so
// the coordinates are restated here as literals with their derivation in a comment. If a stall
// constant ever moves, this file is the thing that says so.

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { GameState } from '../sim';
import { createInitialState } from '../sim';
import { createTrader, type TraderLayer } from './trader';

/** STALL_RADIUS 4.2 at STALL_ANGLE 300°: x = 4.2·cos300° = 2.1, z = 4.2·sin300° = −3.6373… */
const STALL_X = 2.1;
const STALL_Z = -3.637;
/** EDGE_SPAWN, the forest edge the trader walks in from. */
const EDGE_X = 0;
const EDGE_Z = -12;

/** Generous downward ray: from well above the hat, far past the wheels, straight at the origin. */
function downwardRay(x: number, z: number): THREE.Raycaster {
  const ray = new THREE.Raycaster(
    new THREE.Vector3(x, 10, z),
    new THREE.Vector3(0, -1, 0),
  );
  ray.far = 20; // y 10 → −10 is plenty; anything else would be scenery, not the trader
  return ray;
}

/** A visiting/away state at a given point in the visit. Fully typed — no casts. */
function stateAt(phase: 'away' | 'visiting', visitMs: number): GameState {
  const state = createInitialState();
  state.visitor = { phase, inMs: 0, visitMs, tradesLeft: 3 };
  return state;
}

let layer: TraderLayer | null = null;

/** Build the layer once per test and drive it through `update`, exactly as `render()` does. */
function build(state: GameState): TraderLayer {
  layer = createTrader();
  layer.update(state, 0);
  // `Raycaster` reads `matrixWorld`, and the only thing that propagates it in the real app is
  // `renderer.render()` each frame. With no renderer here, the update has to be done by hand —
  // without it every object sits at the identity and no ray ever reaches the rig.
  layer.group.updateMatrixWorld(true);
  return layer;
}

afterEach(() => {
  layer?.dispose();
  layer = null;
});

describe('trader picking — the rig is really in the scene graph', () => {
  it('a ray at the stall hits the trader while they are lingering there', () => {
    // visitMs 12 000 is past the 6 000 ms walk in and before the walk out, so the rig is parked at
    // the stall. This is the assertion that fails if `root` is ever left out of `group` again.
    expect(build(stateAt('visiting', 12_000)).pick(downwardRay(STALL_X, STALL_Z))).toBe(true);
  });

  it('the same ray misses while the trader is away', () => {
    // three's Raycaster ignores `visible`, so `pick` has to gate on it itself. Away means no hit
    // even though the geometry is unchanged — otherwise a click at the stall would open the
    // trade popover for a merchant who is not there.
    expect(build(stateAt('away', 0)).pick(downwardRay(STALL_X, STALL_Z))).toBe(false);
  });
});

describe('trader picking — position follows visitMs', () => {
  it('a ray at the edge spawn hits the rig at the start of the walk', () => {
    // visitMs 0 → p = 0 → the rig is exactly on `EDGE_SPAWN`.
    expect(build(stateAt('visiting', 0)).pick(downwardRay(EDGE_X, EDGE_Z))).toBe(true);
  });

  it('that same ray misses once the rig has walked in to the stall', () => {
    // Same ray, same layer, only `visitMs` differs: the position is read live off the visitor
    // block every frame, so nothing was left behind at the spawn.
    expect(build(stateAt('visiting', 12_000)).pick(downwardRay(EDGE_X, EDGE_Z))).toBe(false);
  });
});