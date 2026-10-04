// Villagers: primitive characters from shared geometry (DESIGN §2 pillar 2 — big head, small body,
// hat as the identity cue) plus T05 selection: every mesh is tagged so a ray hit resolves to a
// villager id, one shared soft ring marks the selection, and `project` anchors the UI / test hook.
// B6 adds the batch-2 poses: a held log while carrying (tend), a stir over the pot (cook), a
// savoring head bob + pooled heart sprites on an `eat` event, and an embers shiver when the fire is
// out. Motion is procedural; all smoothing state lives here, so the sim stays pure (DESIGN §3).

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

// ── B6: batch-2 poses ──────────────────────────────────────────────────────
// Carry: both arms forward at the chest plus a small lean under the load. The log
// rides inside `body`, so it inherits the lean and reads as carried, not stuck on.
const CARRY_RAISE = 0.95; // shoulder pitch (rad) that brings the hands up in front
const CARRY_LEAN = 0.1;
const LOG_Y = 0.42; const LOG_Z = 0.2; // held-log rest position in body-local space
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
// Hearts: 2–3 tiny sprites per meal, ~1 u of lift, gone in ~1.2 s, one shared pool.
const HEART_POOL = 4; const HEART_LIFE_MS = 1200; // a burst is 2–3 hearts, the pool is 4
const HEART_Y = 0.72; const HEART_RISE = 1; const HEART_SIZE = 0.19;

interface Pose {
  bob: number;
  lean: number;
  swing: number;
  raise: number; // shoulder pitch (rad), forward and up
  stir: number; // 0..1 blend of the circular stir on the right hand
}

interface Rig {
  id: string;
  root: THREE.Group;
  body: THREE.Group; // bob (position.y) + work lean (rotation.x)
  head: THREE.Group; // savoring bob rides on the head, never the whole body
  armL: THREE.Group;
  armR: THREE.Group;
  log: THREE.Mesh; // the carried log; hidden and unscaled unless `carrying`
  facing: number;
  phase: number; // per-villager offset so nobody animates in lockstep
  bob: number;
  lean: number;
  swing: number;
  raise: number;
  stir: number;
  carry: number; // 0..1 eased carry blend — drives the log's scale and visibility
  chill: number; // 0..1 eased embers shiver blend
  savor: number; // 0..1 eased savoring-bob blend
  savoring: boolean; // armed by an `eat` event, cleared when that rest ends
}

interface Heart {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  active: boolean;
  ageMs: number;
  ownerId: string; // '' once the eater's rig is gone; the heart then stays put
  x: number;
  z: number;
  spread: number; // -1..1 fan around the head
  phase: number;
}

/** The one heart sprite texture: drawn on a canvas at boot, no external assets. */
function heartTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Flower pink as the base tone, lifted half-way toward the warm off-white for the highlight —
    // both keys already in PALETTE, so the garnish stays inside the village's colour story.
    const lit = new THREE.Color(PALETTE.flowerPink).lerp(new THREE.Color(PALETTE.flowerWhite), 0.5);
    ctx.translate(size / 2, size * 0.52);
    ctx.scale(size / 32, size / 32);
    ctx.beginPath();
    ctx.moveTo(0, 11);
    ctx.bezierCurveTo(0, 11, -13, 0, -13, -7);
    ctx.bezierCurveTo(-13, -16, -4, -19, 0, -12);
    ctx.bezierCurveTo(4, -19, 13, -16, 13, -7);
    ctx.bezierCurveTo(13, 0, 0, 11, 0, 11);
    ctx.fillStyle = PALETTE.flowerPink;
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = `#${lit.getHexString()}`;
    ctx.beginPath();
    ctx.ellipse(-5, -6, 2.6, 3.4, -0.4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false; // a sprite is drawn tiny; mips only cost memory
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
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
  // B6: the held log, pre-rotated so it lies across the body (x axis) and can be
  // scaled from its own centre when the carry pose eases in and out.
  const logGeo = track(new THREE.CylinderGeometry(0.05, 0.052, 0.44, 8));
  logGeo.rotateZ(Math.PI / 2);
  const tunicMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.tunic }));
  const skinMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.skin }));
  const logMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.trunk }));

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

  // B6: one shared heart texture and a fixed pool of sprites — no allocation per meal, and an
  // idle heart is `visible = false`, so it costs nothing but memory.
  const heartTex = track(heartTexture());
  const hearts: Heart[] = [];
  for (let i = 0; i < HEART_POOL; i += 1) {
    const material = track(new THREE.SpriteMaterial({ map: heartTex, transparent: true, opacity: 0, depthWrite: false }));
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    sprite.renderOrder = 3; // over the village, never occluded by the sprites above it
    group.add(sprite);
    hearts.push({ sprite, material, active: false, ageMs: 0, ownerId: '', x: 0, z: 0, spread: 0, phase: 0 });
  }
  let heartSerial = 0; // deterministic stagger source; never Math.random
  let lastEventTick = -1; // `state.events` holds one tick's events, so gate on the tick number

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
    // Shadow casters are the torso and head only (M10): letting arms, hat and pom cast too
    // cost ~32 shadow draws for a silhouette difference nobody can see at play distance.
    torso.castShadow = true;
    body.add(torso);
    const head = new THREE.Group();
    head.position.y = HEAD_Y;
    const face = new THREE.Mesh(headGeo, skinMat);
    face.castShadow = true;
    head.add(face);
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
    // B6: the log is a child of `body`, so the carry lean tips it with the villager. It starts
    // hidden at zero scale — the carry blend is what brings it in, so nothing pops on deposit.
    const log = new THREE.Mesh(logGeo, logMat);
    log.position.set(0, LOG_Y, LOG_Z);
    log.rotation.y = 0.28; // angled across the chest rather than bolted to the front
    log.visible = false;
    body.add(log);
    // T05: tag every mesh so a raycast hit resolves back to the villager it belongs to.
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.userData.villagerId = villager.id;
    });
    root.position.set(villager.pos.x, 0, villager.pos.z);
    root.rotation.y = villager.facing;
    group.add(root);
    return {
      id: villager.id,
      root,
      body,
      head,
      armL,
      armR,
      log,
      facing: villager.facing,
      phase: hash01(index, 71) * TAU,
      bob: 0,
      lean: 0,
      swing: 0,
      raise: 0,
      stir: 0,
      carry: 0,
      chill: 0,
      savor: 0,
      savoring: false,
    };
  }

  /**
   * Target pose per sim state; everything is then eased toward, so nothing snaps. `chill` is the
   * already-eased 0..1 embers blend, so the hunch fades with the tremble instead of switching on.
   */
  function pose(villager: Villager, rig: Rig, timeSec: number, chill: number): Pose {
    const t = timeSec + rig.phase; // per-villager offset: nobody animates in lockstep
    let out: Pose;
    switch (villager.state) {
      case 'walking': {
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

  function animate(rig: Rig, villager: Villager, timeSec: number, dtSec: number, chilly: boolean): void {
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

  /** A free heart, else the oldest one — the pool is fixed, so a burst never allocates. */
  function heartSlot(): Heart | null {
    let free: Heart | null = null;
    let oldest: Heart | null = null;
    for (const heart of hearts) {
      if (!heart.active) {
        free ??= heart;
        continue;
      }
      if (oldest === null || heart.ageMs > oldest.ageMs) oldest = heart;
    }
    return free ?? oldest;
  }

  /** B6: 2–3 hearts for one meal, fanned around the head, all deterministic. */
  function spawnHearts(rig: Rig): void {
    const count = 2 + Math.round(hash01(heartSerial, 93)); // 2 or 3
    for (let i = 0; i < count; i += 1) {
      const heart = heartSlot();
      if (!heart) return; // pool exhausted and nothing to recycle (never happens: HEART_POOL > count)
      heartSerial += 1;
      heart.active = true;
      heart.ageMs = 0;
      heart.ownerId = rig.id;
      heart.x = rig.root.position.x;
      heart.z = rig.root.position.z;
      heart.spread = hash01(heartSerial, 94) * 1.6 - 0.8;
      heart.phase = hash01(heartSerial, 95) * TAU;
      heart.sprite.visible = true;
    }
  }

  /** Advance the pool: lift ~1 u with a decelerating ease, fade in fast and out slow. */
  function advanceHearts(dtMs: number, timeSec: number): void {
    for (const heart of hearts) {
      if (!heart.active) continue;
      heart.ageMs += dtMs;
      const life = heart.ageMs / HEART_LIFE_MS;
      if (life >= 1) {
        heart.active = false;
        heart.sprite.visible = false;
        heart.material.opacity = 0;
        continue;
      }
      const owner = rigs.get(heart.ownerId);
      if (owner) {
        heart.x = owner.root.position.x;
        heart.z = owner.root.position.z;
      }
      const rise = 1 - (1 - life) * (1 - life); // ease-out: the lift decelerates at the top
      const fadeIn = Math.min(1, life / 0.15);
      heart.sprite.position.set(
        heart.x + heart.spread * 0.17 + Math.sin(timeSec * 2.1 + heart.phase) * 0.05,
        HEART_Y + rise * HEART_RISE,
        heart.z - heart.spread * 0.12,
      );
      heart.material.opacity = fadeIn * (1 - life * life);
      heart.sprite.scale.setScalar(HEART_SIZE * (0.65 + 0.35 * fadeIn) * (1 - life * 0.15));
    }
  }

  return {
    group,
    update(state: GameState, timeSec: number, dtMs: number): void {
      const dtSec = Math.min(Math.max(dtMs, 0), 100) / 1000;
      // B6: embers is `fuel === 0`; the sim floors fuel there, `<= 0` also survives a bad load.
      const embers = state.fire.fuel <= 0;
      state.villagers.forEach((villager, i) => {
        let rig = rigs.get(villager.id);
        if (!rig) {
          rig = createRig(villager, i);
          rigs.set(villager.id, rig);
        }
        // The savoring bob belongs to an eating rest only: armed by the `eat` event below and
        // released as soon as the villager leaves `resting`.
        if (villager.state !== 'resting') rig.savoring = false;
        animate(rig, villager, timeSec, dtSec, embers && (villager.state === 'idle' || villager.state === 'resting'));
      });
      const live = new Set(state.villagers.map((v) => v.id));
      for (const [id, rig] of rigs) {
        if (!live.has(id)) {
          group.remove(rig.root);
          rigs.delete(id);
        }
      }
      // B6: one scan per sim tick, not per render pass. `state.events` is cleared and refilled by
      // `tick`, so the tick number is what makes this idempotent — an extra render pass over the
      // same events must not spawn a second set of hearts.
      if (state.tick !== lastEventTick) {
        lastEventTick = state.tick;
        for (const event of state.events) {
          if (event.type !== 'eat' || event.villagerId === undefined) continue;
          const rig = rigs.get(event.villagerId);
          if (!rig) continue;
          rig.savoring = true;
          spawnHearts(rig);
        }
      }
      advanceHearts(dtMs, timeSec);
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
      disposables.forEach((d) => d.dispose()); // heart texture + materials + geometries
      disposables.length = 0;
      hatMats.clear();
      rigs.clear();
      hearts.length = 0; // sprites were children of `group`, dropped by the clear below
      group.clear();
    },
  };
}