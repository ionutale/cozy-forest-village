// Villager poses and motion: the target pose per sim state, and the eased
// application of it. Motion is procedural; all smoothing state lives on the
// rig, so the sim stays pure (DESIGN §3).

import type { Villager } from '../../sim';
import { HEAD_Y, type Rig } from './rig';

const TAU = Math.PI * 2;
const TURN_RATE = 0.012; const EASE = 9; // turn smoothing (per ms), channel easing (per s)
const STEP_RATE = 7.5; const CHOP_HZ = 2.2; const BERRY_HZ = 1.3; // walk cycle, work pulses
const BOB_IDLE = 0.015; const BOB_STEP = 0.03; const LEAN_CHOP = 0.19; const LEAN_BERRY = 0.1;

// ── B6: batch-2 poses ──────────────────────────────────────────────────────
// Carry: both arms forward at the chest plus a small lean under the load. The log
// rides inside `body`, so it inherits the lean and reads as carried, not stuck on.
const CARRY_RAISE = 0.95; // shoulder pitch (rad) that brings the hands up in front
const CARRY_LEAN = 0.1;
const EASE_CARRY = 5.5; // the log arrives and leaves slower than the body pose
// Cook: lean toward the pot with the right hand circling over it at ~1.2 Hz.
const STIR_HZ = 1.2; const STIR_LEAN = 0.17; const STIR_RADIUS = 0.17;
// Tend (M2): stand-watch. A slow 0.6 Hz weight shift with a small forward reach — a keeper
// watches the fire, they do not swing at it. Deliberately near-neutral.
const TEND_HZ = 0.6; const TEND_BOB = 0.012; const TEND_SWING = 0.05;
const TEND_LEAN = 0.02; const TEND_REACH = 0.24;
// Eat: a savoring head bob for the length of the meal rest.
const SAVOR_HZ = 0.8; const SAVOR_BOB = 0.016;
// Embers: a faint tremble, ≤ ±0.006 u at ~7 Hz, plus a small hunch. Never loud.
const CHILL_HZ = 7; const CHILL_AMP = 0.006; const CHILL_HUNCH = 0.05;

export interface Pose {
  bob: number;
  lean: number;
  swing: number;
  raise: number; // shoulder pitch (rad), forward and up
  stir: number; // 0..1 blend of the circular stir on the right hand
}

/** Shortest signed angular distance from `from` to `to`, in (-PI, PI]. */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * Target pose per sim state; everything is then eased toward, so nothing snaps. `chill` is the
 * already-eased 0..1 embers blend, so the hunch fades with the tremble instead of switching on.
 */
export function pose(villager: Villager, rig: Rig, timeSec: number, chill: number): Pose {
  const t = timeSec + rig.phase; // per-villager offset: nobody animates in lockstep
  let out: Pose;
  switch (villager.state) {
    // Batch 6: a newcomer's walk-in is `'arriving'` for the whole walk (H1 flips it to `'idle'` on
    // arrival), so that state falls through here — same step bob, lean and arm swing as any walker.
    // Without it the walk-in glided on the idle pose.
    case 'walking':
    case 'arriving': {
      const step = t * STEP_RATE;
      out = { bob: Math.abs(Math.sin(step)) * BOB_STEP - BOB_STEP / 2, lean: 0.06, swing: Math.sin(step) * 0.5, raise: 0, stir: 0 };
      break;
    }
    case 'working': {
      if (villager.task === 'cook') {
        // B6: pot work is a stir, not a chop — the right hand circles over the cauldron at
        // ~1.2 Hz while the body leans in, and the bob rides that circle.
        const spin = t * TAU * STIR_HZ;
        out = {
          bob: STIR_LEAN * 0.2 + Math.sin(spin) * 0.008,
          lean: STIR_LEAN,
          swing: 0,
          raise: CARRY_RAISE * 0.78, // hands up at the rim
          stir: 1,
        };
        break;
      }
      if (villager.task === 'tend') {
        // M2: a keeper on stand-watch is not chopping. Near-neutral, a slow 0.6 Hz weight
        // shift and a small forward reach — it reads as watching a fire rather than swinging
        // at nothing, which is what the chop branch used to do for every non-cook task. The
        // carry override further down still wins while `carrying`, so fetching is unchanged.
        const sway = Math.sin(t * TAU * TEND_HZ);
        out = {
          bob: sway * TEND_BOB,
          lean: TEND_LEAN + sway * 0.015,
          swing: sway * TEND_SWING,
          raise: TEND_REACH + Math.sin(t * TAU * TEND_HZ * 0.5) * 0.05,
          stir: 0,
        };
        break;
      }
      const berries = villager.task === 'berries';
      const pulse = 0.5 + 0.5 * Math.sin(t * TAU * (berries ? BERRY_HZ : CHOP_HZ));
      const lean = (berries ? LEAN_BERRY : LEAN_CHOP) * pulse;
      out = { bob: lean * 0.25, lean, swing: 0.18 * pulse, raise: 0, stir: 0 };
      break;
    }
    case 'resting':
      out = { bob: Math.sin(t * 1.6) * 0.02, lean: 0, swing: 0, raise: 0, stir: 0 }; // slow breathing
      break;
    case 'idle':
    default:
      out = { bob: Math.sin(t * 1.8) * BOB_IDLE, lean: 0, swing: 0, raise: 0, stir: 0 };
  }
  // B6 carry: hands up in front and a small lean under the load, whatever the villager is doing.
  if (villager.carrying) {
    if (out.raise < CARRY_RAISE) out.raise = CARRY_RAISE;
    out.lean += CARRY_LEAN;
  }
  if (chill > 0) out.lean += CHILL_HUNCH * chill; // embers: a hunch, scaled by the shiver blend
  return out;
}

export function animate(
  rig: Rig,
  villager: Villager,
  timeSec: number,
  dtSec: number,
  chilly: boolean,
): void {
  // Never snap a turn: shortest arc, exponentially approached.
  rig.facing += angleDelta(rig.facing, villager.facing) * (1 - Math.exp(-dtSec * 1000 * TURN_RATE));
  rig.root.rotation.y = rig.facing;
  rig.root.position.x = villager.pos.x;
  rig.root.position.z = villager.pos.z;
  const k = 1 - Math.exp(-dtSec * EASE);
  const kCarry = 1 - Math.exp(-dtSec * EASE_CARRY);
  rig.carry += ((villager.carrying ? 1 : 0) - rig.carry) * kCarry;
  rig.chill += ((chilly ? 1 : 0) - rig.chill) * k;
  rig.savor += ((rig.savoring ? 1 : 0) - rig.savor) * k;
  const target = pose(villager, rig, timeSec, rig.chill);
  rig.bob += (target.bob - rig.bob) * k;
  rig.lean += (target.lean - rig.lean) * k;
  rig.swing += (target.swing - rig.swing) * k;
  rig.raise += (target.raise - rig.raise) * k;
  rig.stir += (target.stir - rig.stir) * k;
  // B6 embers: two detuned sines (|sum| ≤ 1) at ~7 Hz, ±CHILL_AMP, on x and z with their own
  // phase — a tremble in place, never a drift. Gated by the eased chill blend, so a fire that
  // dies while somebody stands there fades into the shiver instead of snapping into it.
  const spin = timeSec * TAU * CHILL_HZ;
  const trembleX = Math.sin(spin) * 0.6 + Math.sin(spin * 0.63 + 1.1) * 0.4;
  const trembleZ = Math.sin(spin * 0.77 + 2.2) * 0.6 + Math.sin(spin * 0.51 + 0.4) * 0.4;
  rig.body.position.set(trembleX * CHILL_AMP * rig.chill, rig.bob, trembleZ * CHILL_AMP * rig.chill);
  rig.body.rotation.x = rig.lean;
  // B6 savoring: only the head dips, so a meal reads as savouring rather than as body motion.
  rig.head.position.y = HEAD_Y + Math.sin((timeSec + rig.phase) * TAU * SAVOR_HZ) * SAVOR_BOB * rig.savor;
  // Arms: swing stays the slice-1 read; `raise` pitches them forward for the carry, and the
  // stir circle is added on top of the right arm only.
  const stir = (timeSec + rig.phase) * TAU * STIR_HZ;
  const stirX = Math.sin(stir) * STIR_RADIUS * rig.stir;
  const stirZ = Math.cos(stir) * STIR_RADIUS * rig.stir * 0.8;
  rig.armL.rotation.set(-rig.raise, 0, -rig.swing);
  rig.armR.rotation.set(-(rig.raise + stirX), 0, rig.swing + stirZ);
  rig.log.visible = rig.carry > 0.004;
  rig.log.scale.setScalar(rig.carry);
}
