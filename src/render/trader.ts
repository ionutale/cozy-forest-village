// The trader (batch 7): a travelling merchant who walks in from the forest edge, sets a small
// handcart down inside the village ring, trades, and walks back out — spec Part 4.
//
// The sim owns *when* (a `visitor` block: phase, inMs, visitMs, tradesLeft) and never tracks a
// trader position. Everything positional here is a pure function of `(phase, visitMs)`:
//
//   visitMs ∈ [0, TRADER_WALK_MS)                 → eased walk in from the edge to the stall
//   visitMs ∈ [TRADER_WALK_MS, stay − WALK)       → linger at the stall, slow sway
//   visitMs ∈ [stay − TRADER_WALK_MS, stay)       → eased walk back out
//   phase === 'away'                               → hidden, nothing to pick
//
// That is why a reload mid-visit puts the trader back on exactly the same spot (Review Focus 1):
// there is no saved position and nothing to drift. No pathing, no clocks, no RNG — the linger
// sway is a fixed-frequency sine off the render clock, and the wheel roll is derived from the
// path parameter rather than accumulated, so it is frame-rate independent too.
//
// The body is built from the shared villager kit (`villagers/rig.ts`) with distinct colours, plus
// the handcart prop, and the selection ring is the shared one from `villagers/ring.ts` — the same
// soft two-tone ring the villagers use, so a trader selection reads instantly.
//
// Zero per-frame allocations: every pose number is written into the module-scope `step` scratch,
// the update reads scalars off the state, and nothing is created, iterated into a closure, or
// returned by value inside the frame loop.

import * as THREE from 'three';
import type { GameState } from '../sim';
import { TRADER_WALK_MS, VISIT_STAY_MS } from '../sim';
import { PALETTE } from './palette';
import { HEAD_Y, createRigKit, hash01 } from './villagers/rig';
import { createSelectionRing } from './villagers/ring';

const TAU = Math.PI * 2;

/** Where the trader appears and disappears: the same forest-edge spawn newcomers use. */
const EDGE_X = 0;
const EDGE_Z = -12;

/**
 * The stall: r = 4.2 at 300°, i.e. in the gap between the feeder (270°) and the pot (330°), so the
 * cart never stands in a structure or on a villager's arrival slot. Mid-ring, in front of the
 * camera's default arc, and out of the campfire's r = 2.2 approach arc.
 */
const STALL_RADIUS = 4.2;
const STALL_ANGLE = (300 * Math.PI) / 180;
const STALL_X = Math.cos(STALL_ANGLE) * STALL_RADIUS;
const STALL_Z = Math.sin(STALL_ANGLE) * STALL_RADIUS;

/** Straight-line length of the walk in and of the walk out (the cart wheels roll along this). */
const PATH_LEN = Math.hypot(STALL_X - EDGE_X, STALL_Z - EDGE_Z);

/** The visit's last TRADER_WALK_MS ms is the walk out. Degenerates safely if the stay is short. */
const WALK_IN_MS = Math.max(TRADER_WALK_MS, 1);
const LEAVE_AT_MS = Math.max(WALK_IN_MS, VISIT_STAY_MS - WALK_IN_MS);

/** Yaw the trader holds while walking in (from the edge toward the stall) and back out. */
const IN_FACING = Math.atan2(STALL_X - EDGE_X, STALL_Z - EDGE_Z);
const OUT_FACING = IN_FACING + Math.PI;
/** While lingering they face the campfire — the stall yaw, i.e. looking in over the village. */
const FIRE_FACING = Math.atan2(-STALL_X, -STALL_Z);

/** Turn toward the campfire over the last stretch of the walk in, and the first of the walk out. */
const TURN_WINDOW = 0.45;

/* Body proportions, matching the villager rig so the two read as the same species (DESIGN §2
   pillar 2): big head, small body, hat as the identity cue. */
const BODY_Y = 0.25;
const HAT_Y = 0.81;
const POM_Y = 0.92;
const SHOULDER_Y = 0.44;
const ARM_X = 0.185;
const ARM_DROP = 0.09;

/** The trader reads as a merchant, not another villager: a muted blue coat and a plum hat. */
const COAT = '#6f8fb0';
const HAT = '#8a6fae';

/* Linger: a slow weight shift, near-neutral (nothing snappy, DESIGN §2 pillar 4). */
const SWAY_HZ = 0.28;
const SWAY_BOB = 0.012;
const SWAY_ROLL = 0.018;
const SWAY_HEAD = 0.02;

/* Walk: the same step cadence and swing the villagers use, so the gait matches. */
const STEP_HZ = 1.2;
const WALK_BOB = 0.03;
const WALK_SWING = 0.5;
const WALK_LEAN = 0.06;

/* Handcart (the prop that says "merchant" at play distance). */
const CART_Z = -0.68; // behind the trader in body-local space — they pull it
const CART_BED_Y = 0.28;
const WHEEL_R = 0.19;
const WHEEL_X = 0.27;
const CART_TILT = 0.02; // the cart settles onto its axle when the trader stops

/**
 * The ring sits a hair above the grass (y 0) and the tan clearing disc (y 0.01). `ring.ts` keeps
 * its own copy private, and the trader's layer owns a separate ring group, so this mirrors that
 * one number rather than importing the module.
 */
const RING_Y = 0.015;
/** Same 1.2 s cosine breath the villager ring breathes (mirrors `ring.ts`). */
const RING_BREATH_S = 1.2;
const RING_BREATH = 0.04;

/** Shorthand for a scratch written in place — nothing here is ever retained. */
interface Step {
  /** True while the trader is on either leg of the walk. */
  walking: boolean;
  /** True on the walk back out. */
  leaving: boolean;
  /** 0 at the edge, 1 at the stall. Drives the body position. */
  p: number;
  /** 0→1 along the current leg, always in the direction of travel — drives the wheel roll. */
  leg: number;
  /** 0→1 through the current turn window; 0 while lingering. */
  turn: number;
  /** The yaw the body holds at this instant, already blended through the turn windows. */
  facing: number;
}

const step: Step = { walking: false, leaving: false, p: 0, leg: 0, turn: 0, facing: FIRE_FACING };

/** Smoothstep — the only easing the path needs, and it never overshoots. */
function smooth01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Shortest signed angular distance from `from` to `to`, in (-PI, PI]. */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d -= TAU;
  return d;
}

/** Blend one yaw into another over the shortest arc — no wrap surprises mid-turn. */
function blendFacing(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

/**
 * Where `visitMs` sits on the visit: which leg, the eased path parameter, the yaw, and how far
 * along that leg they have walked. Pure and allocation-free — the shared `step` is filled in and
 * returned.
 */
function stepAt(visitMs: number): Step {
  const t = Number.isFinite(visitMs) && visitMs > 0 ? visitMs : 0;
  if (t < WALK_IN_MS) {
    // Walk in: edge → stall, eased. The turn toward the campfire rides the last stretch.
    const u = smooth01(t / WALK_IN_MS);
    step.walking = true;
    step.leaving = false;
    step.p = u;
    step.leg = u; // distance along this leg, always forward, for the wheel roll
    step.turn = smooth01((u - (1 - TURN_WINDOW)) / TURN_WINDOW);
    step.facing = blendFacing(IN_FACING, FIRE_FACING, step.turn);
    return step;
  }
  if (t < LEAVE_AT_MS) {
    // Linger: parked at the stall, looking in over the village.
    step.walking = false;
    step.leaving = false;
    step.p = 1;
    step.leg = 1;
    step.turn = 0;
    step.facing = FIRE_FACING;
    return step;
  }
  // Walk out: stall → edge, mirrored, and the turn to the exit heading leads the walk.
  const u = smooth01((t - LEAVE_AT_MS) / WALK_IN_MS);
  step.walking = true;
  step.leaving = true;
  step.p = 1 - u;
  step.leg = u;
  step.turn = smooth01(u / TURN_WINDOW);
  step.facing = blendFacing(FIRE_FACING, OUT_FACING, step.turn);
  return step;
}

export interface TraderLayer {
  group: THREE.Group;
  /** Read-only over the sim's `visitor` block; every visual is derived from `(phase, visitMs)`. */
  update(state: GameState, timeSec: number): void;
  /** True when the ray hits the trader or the cart while they are on stage. */
  pick(raycaster: THREE.Raycaster): boolean;
  /** The shared selection ring, on/off. Applied by the next update(). */
  setSelected(on: boolean): void;
  dispose(): void;
}

export function createTrader(): TraderLayer {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // The shared villager kit: same geometry and materials as every villager, so the trader reads
  // as one of them at a glance. Only the coat and hat colours are the trader's own.
  const kit = createRigKit(track);
  const coatMat = track(new THREE.MeshLambertMaterial({ color: COAT }));
  const cartMat = track(new THREE.MeshLambertMaterial({ color: COAT }));
  const hatMats = kit.hatMaterials(HAT);
  const clothMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.flowerWhite }));

  const root = new THREE.Group(); // position + yaw, derived from (phase, visitMs)
  const body = new THREE.Group(); // bob + lean + the sway roll
  root.add(body);

  const torso = new THREE.Mesh(kit.bodyGeo, coatMat);
  torso.position.y = BODY_Y;
  torso.scale.set(1, 1.45, 1);
  torso.castShadow = true;
  body.add(torso);

  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  const face = new THREE.Mesh(kit.headGeo, kit.skinMat);
  face.castShadow = true;
  head.add(face);
  const hat = new THREE.Mesh(kit.hatGeo, hatMats.cone);
  hat.position.y = HAT_Y - HEAD_Y;
  const pom = new THREE.Mesh(kit.pomGeo, hatMats.pom);
  pom.position.y = POM_Y - HEAD_Y;
  head.add(hat, pom);
  body.add(head);

  // Both arms: the right one reaches back to the cart's handle while the trader walks.
  const armGeo = kit.armGeo;
  const makeArm = (side: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(ARM_X * side, SHOULDER_Y, 0);
    const mesh = new THREE.Mesh(armGeo, kit.skinMat);
    mesh.position.y = -ARM_DROP;
    pivot.add(mesh);
    return pivot;
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);
  body.add(armL, armR);

  /* The handcart: a painted bed, two wheels on an axle, two shafts back to the trader's hands,
     and the goods. It hangs off `root` (not the level ground) so it inherits the trader's yaw and
     needs no position state of its own — a trailing cart that turns when its puller turns. */
  const cart = new THREE.Group();
  cart.position.set(0, 0, CART_Z);
  function part(geo: THREE.BufferGeometry, mat: THREE.Material, pos: readonly [number, number, number]): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.castShadow = true;
    cart.add(mesh);
    return mesh;
  }
  // Bed + side rails, one tone; a slatted look comes from the rails, not from texture work.
  part(track(new THREE.BoxGeometry(0.5, 0.05, 0.42)), cartMat, [0, CART_BED_Y, 0]);
  part(track(new THREE.BoxGeometry(0.05, 0.16, 0.42)), cartMat, [-0.24, CART_BED_Y + 0.09, 0]);
  part(track(new THREE.BoxGeometry(0.05, 0.16, 0.42)), cartMat, [0.24, CART_BED_Y + 0.09, 0]);
  // Axle along x, then the wheels whose axis is x too — so rolling forward is spin about x.
  part(track(new THREE.CylinderGeometry(0.02, 0.02, 0.52, 6).rotateX(Math.PI / 2)), cartMat, [0, 0.2, 0]);
  const wheelGeo = track(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.05, 10).rotateZ(Math.PI / 2));
  const wheelL = part(wheelGeo, kit.logMat, [-WHEEL_X, 0.2, 0]);
  const wheelR = part(wheelGeo, kit.logMat, [WHEEL_X, 0.2, 0]);
  // Shafts reaching forward to the trader's hands, plus the goods that make it a cart and not a barrow.
  part(track(new THREE.CylinderGeometry(0.02, 0.02, 0.46, 6).rotateZ(Math.PI / 2)), cartMat, [-0.16, 0.3, 0.26]);
  part(track(new THREE.CylinderGeometry(0.02, 0.02, 0.46, 6).rotateZ(Math.PI / 2)), cartMat, [0.16, 0.3, 0.26]);
  part(track(new THREE.BoxGeometry(0.2, 0.2, 0.2)), kit.logMat, [0.04, CART_BED_Y + 0.13, -0.06]);
  part(track(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 8)), clothMat, [-0.14, CART_BED_Y + 0.13, 0.08]);
  cart.rotation.x = CART_TILT; // the load sits back on its axle while walking
  root.add(cart);

  // The shared selection ring (villagers/ring.ts) — its own group under `group`, so it does not
  // inherit the trader's yaw.
  const ringGroup = createSelectionRing(track, group);
  let selected = false;

  // Everything is assembled, so the body rig can go into the layer group. Without this the scene
  // only ever held the ring and the trader was invisible and unpickable on every machine.
  group.add(root);

  // A ray hit anywhere on the trader or the cart is a hit on the trader.
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.userData.trader = true;
  });

  // A fixed per-trader offset so the sway never lands in step with anything else.
  const swayPhase = hash01(0, 313) * TAU;

  return {
    group,
    update(state: GameState, timeSec: number): void {
      const visiting = state.visitor.phase === 'visiting';
      group.visible = visiting;
      // The ring is only ever lit while the trader is actually on stage.
      if (!visiting) {
        ringGroup.visible = false;
        return;
      }
      const s = stepAt(state.visitor.visitMs);
      root.position.set(EDGE_X + (STALL_X - EDGE_X) * s.p, 0, EDGE_Z + (STALL_Z - EDGE_Z) * s.p);
      root.rotation.y = s.facing;

      if (s.walking) {
        // Gait: a step bob and an alternating arm swing, keyed off the render clock. The right arm
        // stays pitched back toward the cart shafts while walking and eases forward when parked.
        const cadence = timeSec * TAU * STEP_HZ + swayPhase;
        body.position.y = Math.abs(Math.sin(cadence)) * WALK_BOB - WALK_BOB / 2;
        body.rotation.x = WALK_LEAN;
        body.rotation.z = 0;
        const swing = Math.sin(cadence) * WALK_SWING;
        const reach = s.leaving ? 0.55 : 0.75;
        armL.rotation.set(-reach * 0.5, 0, -swing);
        armR.rotation.set(-reach, 0, swing);
        head.position.y = HEAD_Y;
        // The cart needs no yaw of its own: it trails at a fixed offset under `root`, so it inherits the
        // trader's yaw and stays aligned with the walk on both legs and while parked. `rotation.y`
        // would spin it about its own origin (its position never moves), so any counter-term here
        // only skews the shafts off the trader's hands — I1.
        cart.rotation.y = 0;
        // Roll is derived from the distance along the current leg, never accumulated, so it is
        // exact on a reload. The two legs restart it at 0 — invisible, the wheels are unspoked.
        const roll = (PATH_LEN * s.leg) / WHEEL_R;
        wheelL.rotation.x = roll;
        wheelR.rotation.x = roll;
        cart.rotation.x = CART_TILT;
      } else {
        // Linger: a slow, near-neutral weight shift with the hands easing off the shafts.
        const sway = Math.sin((timeSec * TAU * SWAY_HZ + swayPhase));
        body.position.y = sway * SWAY_BOB;
        body.rotation.x = 0.02;
        body.rotation.z = sway * SWAY_ROLL;
        armL.rotation.set(-0.06, 0, sway * 0.08);
        armR.rotation.set(-0.06, 0, -sway * 0.08);
        head.position.y = HEAD_Y + Math.sin((timeSec * TAU * SWAY_HZ * 0.7 + swayPhase)) * SWAY_HEAD;
        wheelL.rotation.x = PATH_LEN / WHEEL_R;
        wheelR.rotation.x = PATH_LEN / WHEEL_R;
        cart.rotation.x = 0;
        cart.rotation.y = 0; // parked square behind the trader, looking in with them
      }

      // The ring trails the trader and breathes on the same 1.2 s cycle as the villager ring.
      ringGroup.visible = selected;
      if (selected) {
        ringGroup.position.set(root.position.x, RING_Y, root.position.z);
        ringGroup.scale.setScalar(1 + (1 - Math.cos((timeSec * TAU) / RING_BREATH_S)) * RING_BREATH);
      }
    },
    pick(raycaster: THREE.Raycaster): boolean {
      // three's Raycaster ignores `visible`, so an away trader's meshes are gated here instead.
      if (!group.visible) return false;
      const hits = raycaster.intersectObjects(group.children, true);
      for (const hit of hits) {
        if (hit.object.userData.trader === true) return true;
      }
      return false;
    },
    setSelected(on: boolean): void {
      selected = on; // applied by the next update(), where the trader's position is known
    },
    dispose(): void {
      disposables.forEach((d) => d.dispose());
      disposables.length = 0;
      kit.clearCache();
      group.clear();
    },
  };
}