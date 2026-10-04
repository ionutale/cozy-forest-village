// Villagers: primitive characters from shared geometry (DESIGN §2 pillar 2 — big head, small body,
// hat as the identity cue) plus T05 selection: every mesh is tagged so a ray hit resolves to a
// villager id, one shared soft ring marks the selection, and `project` anchors the UI / test hook.
// Motion is procedural; all smoothing state lives here, so the sim stays pure (DESIGN §3).

import * as THREE from 'three';
import type { GameState, Villager } from '../sim';
import { PALETTE } from './palette';

export interface VillagersLayer {
  group: THREE.Group;
  update(state: GameState, timeSec: number, dtMs: number): void;
  /** T05: nearest villager along a ray, the shared selection ring, and rig → NDC projection. */
  pick(raycaster: THREE.Raycaster): string | null;
  setSelected(villagerId: string | null): void;
  /** Writes NDC xy into `out`; false when unknown or behind the camera. */
  project(villagerId: string, camera: THREE.Camera, out: THREE.Vector2): boolean;
  dispose(): void;
}

const TAU = Math.PI * 2;
const BODY_Y = 0.25; const HEAD_Y = 0.6; const HAT_Y = 0.81; const POM_Y = 0.92; // ~0.97u villager
const SHOULDER_Y = 0.44; const ARM_X = 0.185; const ARM_DROP = 0.09; // capsule is 0.18u long
const TURN_RATE = 0.012; const EASE = 9; // turn smoothing (per ms), channel easing (per s)
const STEP_RATE = 7.5; const CHOP_HZ = 2.2; const BERRY_HZ = 1.3; // walk cycle, work pulses
const BOB_IDLE = 0.015; const BOB_STEP = 0.03; const LEAN_CHOP = 0.19; const LEAN_BERRY = 0.1;
const RING_Y = 0.015; // above the grass (y 0) and the clearing disc (y 0.01): no z-fighting
const PICK_LIFT = 0.5; // project mid-body so the pixel lands on the character

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

  // T05: the one shared selection ring — two tones so it reads at a glance on both the grass
  // and the tan clearing disc: a soft warm-white halo underneath, a thin accent ring on top.
  // Rounded and translucent, never a hard UI outline (pillars 1 and 4). PALETTE.accent is the
  // 3D mirror of --accent and PALETTE.flowerWhite the warm off-white standing in for --paper.
  const ringGroup = new THREE.Group();
  const halo = new THREE.Mesh(
    track(new THREE.RingGeometry(0.28, 0.37, 48)),
    track(new THREE.MeshBasicMaterial({ color: PALETTE.flowerWhite, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide })),
  );
  const accent = new THREE.Mesh(
    track(new THREE.RingGeometry(0.31, 0.345, 48)),
    track(new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide })),
  );
  halo.rotation.x = accent.rotation.x = -Math.PI / 2; // flat on the ground
  halo.renderOrder = 1;
  accent.renderOrder = 2; // the halo can never win a transparent sort against it
  ringGroup.add(halo, accent);
  ringGroup.visible = false;
  group.add(ringGroup);
  let selectedId: string | null = null;
  const scratch = new THREE.Vector3();

  /** One arm on a shoulder pivot; `side` is -1 (left) or +1 (right). */
  function armPivot(side: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(ARM_X * side, SHOULDER_Y, 0);
    const mesh = new THREE.Mesh(armGeo, skinMat);
    mesh.position.y = -ARM_DROP;
    pivot.add(mesh);
    return pivot;
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
    const armL = armPivot(-1);
    const armR = armPivot(1);
    body.add(armL, armR);
    // T05: tag every mesh so a raycast hit resolves back to the villager it belongs to.
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.castShadow = true;
      obj.userData.villagerId = villager.id;
    });
    root.position.set(villager.pos.x, 0, villager.pos.z);
    root.rotation.y = villager.facing;
    group.add(root);
    return { root, body, armL, armR, facing: villager.facing, phase: hash01(index, 71) * TAU, bob: 0, lean: 0, swing: 0 };
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
      for (const [id, rig] of rigs) {
        if (!live.has(id)) {
          group.remove(rig.root);
          rigs.delete(id);
        }
      }
      // The ring trails the selected rig every frame, hidden when nothing is selected (including
      // when the selected id has no rig). Its cosine breath runs 1.0 → 1.08 → 1.0 over 1.2 s,
      // easing at both ends so it never snaps.
      const picked = selectedId === null ? undefined : rigs.get(selectedId);
      ringGroup.visible = picked !== undefined;
      if (picked) {
        ringGroup.position.set(picked.root.position.x, RING_Y, picked.root.position.z);
        ringGroup.scale.setScalar(1 + (1 - Math.cos((timeSec * TAU) / 1.2)) * 0.04);
      }
    },
    pick(raycaster: THREE.Raycaster): string | null {
      // Nearest tagged mesh wins. The ring is untagged, so a hit on it is just skipped.
      for (const hit of raycaster.intersectObjects(group.children, true)) {
        const id: unknown = hit.object.userData.villagerId;
        if (typeof id === 'string') return id;
      }
      return null;
    },
    setSelected(villagerId: string | null): void {
      selectedId = villagerId; // applied by the next update(), once a rig exists
    },
    project(villagerId: string, camera: THREE.Camera, out: THREE.Vector2): boolean {
      const rig = rigs.get(villagerId);
      if (!rig) return false;
      rig.root.getWorldPosition(scratch);
      scratch.y += PICK_LIFT;
      scratch.project(camera);
      // z > 1 means the rig is behind the camera, where the xy projection is meaningless.
      if (scratch.z > 1) return false;
      out.set(scratch.x, scratch.y);
      return true;
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