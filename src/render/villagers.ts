// Villagers: primitive characters built from shared geometry (DESIGN §2 pillar 2 —
// big head, small body, hat as the identity cue). All motion is procedural and driven
// only by `timeSec`/`dtMs` + sim state; all smoothing state lives in this layer so the
// sim stays pure (DESIGN §3).

import * as THREE from 'three';
import type { GameState, Villager } from '../sim';
import { PALETTE } from './palette';

export interface VillagersLayer {
  group: THREE.Group;
  update(state: GameState, timeSec: number, dtMs: number): void;
  dispose(): void;
}

const TAU = Math.PI * 2;
const BODY_Y = 0.25; // ~0.49u tall, radius ~0.17 (small body)
const HEAD_Y = 0.6; // radius 0.15 (big head)
const HAT_Y = 0.81; // 0.2u cone sitting on the skull
const POM_Y = 0.92;
const SHOULDER_Y = 0.44;
const ARM_X = 0.185;
const ARM_DROP = 0.09; // capsule is 0.18u long, pivoting at the shoulder
const TURN_RATE = 0.012; // shortest-arc turn smoothing coefficient (per ms)
const EASE = 9; // generic per-second easing rate for bob/lean/arm transitions
const STEP_RATE = 7.5; // rad/s of the step cycle while walking (~1.2 Hz)
const CHOP_HZ = 2.2;
const BERRY_HZ = 1.3;
const BOB_IDLE = 0.015; // micro bob amplitude while idle
const BOB_STEP = 0.03;
const LEAN_CHOP = 0.19;
const LEAN_BERRY = 0.1;

interface Rig {
  root: THREE.Group;
  body: THREE.Group; // bob (position.y) + work lean (rotation.x)
  armL: THREE.Group;
  armR: THREE.Group;
  facing: number;
  phase: number; // per-villager offset so nobody animates in lockstep
  bob: number;
  lean: number;
  swing: number;
}

/** Deterministic 0..1 hash — no RNG, no state. */
function hash01(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Shortest signed angular distance from `from` to `to`, in (-PI, PI]. */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function createVillagers(): VillagersLayer {
  const group = new THREE.Group();
  const rigs = new Map<string, Rig>();
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // Shared geometry + shared skin/tunic materials across all villagers.
  const bodyGeo = track(new THREE.SphereGeometry(0.17, 12, 8));
  const headGeo = track(new THREE.SphereGeometry(0.15, 14, 10));
  const hatGeo = track(new THREE.ConeGeometry(0.17, 0.2, 10));
  const pomGeo = track(new THREE.SphereGeometry(0.05, 8, 6));
  const armGeo = track(new THREE.CapsuleGeometry(0.045, 0.09, 3, 8));
  const tunicMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.tunic }));
  const skinMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.skin }));

  // One hat material pair per distinct hat color, reused by cone + pom.
  const hatMats = new Map<string, { cone: THREE.MeshLambertMaterial; pom: THREE.MeshLambertMaterial }>();
  function hatMaterials(hatColor: string): { cone: THREE.MeshLambertMaterial; pom: THREE.MeshLambertMaterial } {
    const cached = hatMats.get(hatColor);
    if (cached) return cached;
    const made = {
      cone: track(new THREE.MeshLambertMaterial({ color: hatColor })),
      pom: track(new THREE.MeshLambertMaterial({ color: new THREE.Color(hatColor).multiplyScalar(0.8) })),
    };
    hatMats.set(hatColor, made);
    return made;
  }

  function createRig(villager: Villager, index: number): Rig {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const torso = new THREE.Mesh(bodyGeo, tunicMat);
    torso.position.y = BODY_Y;
    torso.scale.set(1, 1.45, 1);
    body.add(torso);

    const head = new THREE.Group();
    head.position.y = HEAD_Y;
    head.add(new THREE.Mesh(headGeo, skinMat));
    const mats = hatMaterials(villager.hatColor);
    const hat = new THREE.Mesh(hatGeo, mats.cone);
    hat.position.y = HAT_Y - HEAD_Y;
    const pom = new THREE.Mesh(pomGeo, mats.pom);
    pom.position.y = POM_Y - HEAD_Y;
    head.add(hat, pom);
    body.add(head);

    const armL = new THREE.Group();
    const armR = new THREE.Group();
    armL.position.set(-ARM_X, SHOULDER_Y, 0);
    armR.position.set(ARM_X, SHOULDER_Y, 0);
    const armLMesh = new THREE.Mesh(armGeo, skinMat);
    const armRMesh = new THREE.Mesh(armGeo, skinMat);
    armLMesh.position.y = -ARM_DROP;
    armRMesh.position.y = -ARM_DROP;
    armL.add(armLMesh);
    armR.add(armRMesh);
    body.add(armL, armR);

    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.castShadow = true;
    });
    root.position.set(villager.pos.x, 0, villager.pos.z);
    root.rotation.y = villager.facing;
    group.add(root);

    return {
      root,
      body,
      armL,
      armR,
      facing: villager.facing,
      phase: hash01(index, 71) * TAU,
      bob: 0,
      lean: 0,
      swing: 0,
    };
  }

  /** Target pose per sim state; everything is then eased toward, so nothing snaps. */
  function pose(villager: Villager, rig: Rig, timeSec: number): { bob: number; lean: number; swing: number } {
    const t = timeSec + rig.phase; // per-villager offset: nobody animates in lockstep
    switch (villager.state) {
      case 'walking': {
        const step = t * STEP_RATE;
        return { bob: Math.abs(Math.sin(step)) * BOB_STEP - BOB_STEP / 2, lean: 0.06, swing: Math.sin(step) * 0.5 };
      }
      case 'working': {
        const berries = villager.task === 'berries';
        const pulse = 0.5 + 0.5 * Math.sin(t * TAU * (berries ? BERRY_HZ : CHOP_HZ));
        const lean = (berries ? LEAN_BERRY : LEAN_CHOP) * pulse;
        return { bob: lean * 0.25, lean, swing: 0.18 * pulse };
      }
      case 'resting':
        return { bob: Math.sin(t * 1.6) * 0.02, lean: 0, swing: 0 }; // slow breathing
      case 'idle':
      default:
        return { bob: Math.sin(t * 1.8) * BOB_IDLE, lean: 0, swing: 0 };
    }
  }

  function animate(rig: Rig, villager: Villager, timeSec: number, dtSec: number): void {
    // Never snap a turn: shortest arc, exponentially approached.
    rig.facing += angleDelta(rig.facing, villager.facing) * (1 - Math.exp(-dtSec * 1000 * TURN_RATE));
    rig.root.rotation.y = rig.facing;
    rig.root.position.x = villager.pos.x;
    rig.root.position.z = villager.pos.z;

    const target = pose(villager, rig, timeSec);
    const k = 1 - Math.exp(-dtSec * EASE);
    rig.bob += (target.bob - rig.bob) * k;
    rig.lean += (target.lean - rig.lean) * k;
    rig.swing += (target.swing - rig.swing) * k;
    rig.body.position.y = rig.bob;
    rig.body.rotation.x = rig.lean;
    rig.armL.rotation.z = -rig.swing;
    rig.armR.rotation.z = rig.swing;
  }

  return {
    group,
    update(state: GameState, timeSec: number, dtMs: number): void {
      const dtSec = Math.min(Math.max(dtMs, 0), 100) / 1000;
      state.villagers.forEach((villager, i) => {
        let rig = rigs.get(villager.id);
        if (!rig) {
          rig = createRig(villager, i);
          rigs.set(villager.id, rig);
        }
        animate(rig, villager, timeSec, dtSec);
      });
      const live = new Set(state.villagers.map((v) => v.id));
      rigs.forEach((rig, id) => {
        if (live.has(id)) return;
        group.remove(rig.root);
        rigs.delete(id);
      });
    },
    dispose(): void {
      disposables.forEach((d) => d.dispose());
      disposables.length = 0;
      hatMats.clear();
      rigs.clear();
      group.clear();
    },
  };
}
