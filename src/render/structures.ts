// Structures: one low-poly model per village structure (DESIGN §2 pillars 1–2, §3.2 catalog).
// A5: a model is no longer one mesh per primitive. Every *static* part of a kind is baked into a
// single merged BufferGeometry (part transforms folded in, one shared geometry per kind), so a
// whole structure costs one draw call instead of one per box/cylinder. The built variants share
// one vertex-coloured Lambert material so even the multi-coloured kinds merge; the ghosts reuse
// the very same geometry under the single translucent sheet, which keeps the silhouette honest.
// Only the parts that move on their own — the pot's bowls, its steam, the garden's sprouts —
// stay separate, as InstancedMeshes. Lantern lamps stay their own unlit mesh for the same reason.
//
// A5: meals past six are readable again. The stack grows a second column beside the first, the
// topmost bowl takes a modest size step, and the steam thickens — all pure functions of
// `pot.meals`. No timers, no per-frame allocation, no Math.random.
//
// Picking is unchanged and must stay that way: every mesh in the group — merged, instanced and
// lamp alike — carries `userData.structureId`, and the hit path reads it off `hit.object`. Nothing
// is instanced *across* structures, so there is no instanceId → structureId map to maintain.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GameState, Structure, StructureKind } from '../sim';
import { PALETTE } from './palette';

export interface StructuresLayer {
  group: THREE.Group;
  update(state: GameState, timeSec: number): void;
  /** B5: closest structure along the ray — built or ghost — or null. */
  pick(raycaster: THREE.Raycaster): string | null;
  dispose(): void;
}

const GARDEN_PERIOD_MS = 30000; // DESIGN §3.2: render only mirrors the sim's berry period
const MEAL_STACK = 6; // bowls in the single column; past this the pot reads as over-full (A5)
const MEAL_BOWLS = 8; // A5: cap, not a clamp-to-6 — see `bowlSlot` for the second column
const MEAL_TOP_STEP = 1.15; // A5: modest size step on the top bowl once meals pass six
const MEAL_TOP_STEP_FROM = 7; // ...which starts at the seventh meal
const SPROUTS = 6;
const STEAM_WISPS = 3;
/** How far and how fast a wisp rises, in world units and turns per second. */
const STEAM_RISE = 0.35;
const STEAM_TOP = 0.5; // where a wisp starts its climb, above the cauldron rim
const STEAM_HEIGHT = 0.55;
const STEAM_BASE = 0.55; // wisp scale at the foot of its rise
const STEAM_GROWTH = 0.85; // extra scale gained over the full rise
const LAMP_LIGHT = 0.5;
const LAMP_RANGE = 6;
/** A5: steam widens by this much per bowl past `MEAL_STACK`. */
const STEAM_PLUMP = 0.12;
/** The widest the steam ever gets — at the bowl cap. `steamBounds()` is sized for exactly this. */
const STEAM_PLUMP_MAX = 1 + STEAM_PLUMP * (MEAL_BOWLS - MEAL_STACK);
/** A5: the widest a sprout ever sways, as a roll in radians. */
const SPROUT_SWAY = 0.05;

type Vec3 = readonly [number, number, number];
type Rot3 = readonly [number, number, number];

/** One primitive waiting to be folded into its kind's merged geometry. */
interface Part {
  geo: THREE.BufferGeometry;
  color: string; // PALETTE hex; baked per-vertex for the built model, ignored by the ghost
  pos: Vec3;
  rot?: Rot3;
  scale?: Vec3;
}

/** Material a chunk renders with when built. A ghost overrides every slot with `ghostMat`. */
type Slot = 'solid' | 'lamp';

/** A kind's static geometry for one material slot, shared by every model of that kind. */
interface Chunk {
  slot: Slot;
  geo: THREE.BufferGeometry;
}

interface Variant {
  root: THREE.Group;
  bowls: THREE.InstancedMesh | null;
  steam: THREE.InstancedMesh | null;
  sprouts: THREE.InstancedMesh | null;
  lamp: THREE.PointLight | null;
}

interface Model {
  built: Variant;
  ghost: Variant;
}

/** Every ancestor visible? three's Raycaster ignores `visible`, so picking has to check it. */
function shown(obj: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = obj; o !== null; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Yaw that turns a model's +z front toward the campfire at the origin. */
function faceFire(pos: Structure['pos']): number {
  return Math.atan2(-pos.x, -pos.z);
}

/**
 * A5: these three are called from the per-frame update loop, so each writes into a shared scratch
 * rather than returning a fresh array or object. Read the fields before the next call — nothing
 * retains them.
 */
const slot = { x: 0, y: 0, z: 0 };
const pose = { y: 0, scale: 1 };

/** Where bowl `i` sits: the first six stack in the column B5 drew, past six a second column. */
function bowlSlot(i: number): typeof slot {
  slot.x = 0.46 + (i < MEAL_STACK ? 0 : 0.17);
  slot.y = 0.035 + (i % MEAL_STACK) * 0.055;
  slot.z = 0.2;
  return slot;
}

/** XZ footprint of sprout `i` in the garden patch — shared by the loop and the patch bounds. */
function sproutSlot(i: number): typeof slot {
  slot.x = ((i % 3) - 1) * 0.3;
  slot.y = 0.12;
  slot.z = i < 3 ? -0.17 : 0.17;
  return slot;
}

/**
 * Where a wisp sits at rise phase `t` (0 at the cauldron rim, 1 at the top of its climb), and how
 * big it is there. The update loop and `steamBounds` both go through this, so the sealed bounds
 * cannot drift away from the animation they are meant to contain.
 */
function steamPose(t: number, plump: number): typeof pose {
  pose.y = STEAM_TOP + t * STEAM_HEIGHT;
  pose.scale = (STEAM_BASE + t * STEAM_GROWTH) * plump;
  return pose;
}

export function createStructures(): StructuresLayer {
  const group = new THREE.Group();
  const models = new Map<string, Model>();
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // Shared geometry: the instanced cues draw from this set; every static part bakes into the
  // per-kind merged buffers instead (see `bake`).
  const bowlGeo = track(new THREE.CylinderGeometry(0.085, 0.06, 0.05, 10));
  const sproutGeo = track(new THREE.ConeGeometry(0.07, 0.2, 6));
  const steamGeo = track(new THREE.SphereGeometry(0.07, 8, 6));

  // Shared materials.
  const solidMat = track(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }));
  const creamMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.flowerWhite }));
  const sproutMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.tuftA }));
  const lampMat = track(new THREE.MeshBasicMaterial({ color: PALETTE.sun }));
  const steamMat = track(new THREE.MeshBasicMaterial({ color: PALETTE.mote, transparent: true, opacity: 0.32, depthWrite: false }));
  const ghostMat = track(new THREE.MeshBasicMaterial({
    color: PALETTE.flowerWhite,
    transparent: true,
    opacity: 0.22, // B5: a hint of what will stand here, never a solid preview
    depthWrite: false,
  }));

  const FLAT: Rot3 = [-Math.PI / 2, 0, 0];

  // --- baking -----------------------------------------------------------------------------
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scaleVec = new THREE.Vector3(1, 1, 1);
  const color = new THREE.Color();
  /** One chunk per material slot per kind, baked on first use and shared by built + ghost. */
  const baked = new Map<StructureKind, Chunk[]>();

  /**
   * Fold a chunk's parts into one indexed geometry: transforms applied, and a colour attribute
   * carrying each part's palette hex. Ghosts ignore those colours (their material is unlit and not
   * vertex-coloured), which is why a built model and its ghost can share the very same buffer.
   */
  function bake(parts: readonly Part[]): THREE.BufferGeometry {
    const pieces: THREE.BufferGeometry[] = [];
    const spans: Array<{ from: number; to: number }> = [];
    let at = 0;
    for (const part of parts) {
      const g = part.geo.clone();
      euler.set(part.rot ? part.rot[0] : 0, part.rot ? part.rot[1] : 0, part.rot ? part.rot[2] : 0);
      quat.setFromEuler(euler);
      position.set(part.pos[0], part.pos[1], part.pos[2]);
      if (part.scale) scaleVec.set(part.scale[0], part.scale[1], part.scale[2]);
      else scaleVec.set(1, 1, 1);
      matrix.compose(position, quat, scaleVec);
      g.applyMatrix4(matrix);
      const count = g.getAttribute('position').count;
      pieces.push(g);
      spans.push({ from: at, to: at + count });
      at += count;
    }
    const geo = track(mergeGeometries(pieces, false) ?? new THREE.BufferGeometry());
    pieces.forEach((g) => g.dispose());
    const colors = new Float32Array(at * 3);
    let cursor = 0;
    parts.forEach((part, i) => {
      const span = spans[i];
      if (!span) return;
      color.set(part.color);
      for (let v = span.from; v < span.to; v++) {
        colors[cursor] = color.r;
        colors[cursor + 1] = color.g;
        colors[cursor + 2] = color.b;
        cursor += 3;
      }
    });
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeBoundingSphere();
    return geo;
  }

  /**
   * An InstancedMesh whose instances the update loop drives; `count` doubles as its visibility,
   * since every cue fills in as a prefix.
   *
   * `envelope` is the sphere the cue can ever occupy across a whole animation cycle. three caches
   * `boundingSphere` on first use and both frustum culling and `Raycaster` test against it, so a
   * cue that moves must be given bounds that contain where it *travels*, not where it happens to
   * sit when the sphere was first computed — otherwise a risen steam wisp gets culled, and a
   * click aimed at it falls through to whatever is behind.
   */
  function cue(geo: THREE.BufferGeometry, material: THREE.Material, count: number, envelope: THREE.Sphere): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, material, count);
    mesh.castShadow = true;
    mesh.boundingSphere = envelope;
    return mesh;
  }

  /** Unit-space radius of a cue's geometry — its own bounds, before any instance scale. */
  function localRadius(geo: THREE.BufferGeometry): number {
    if (geo.boundingSphere === null) geo.computeBoundingSphere();
    return geo.boundingSphere?.radius ?? 0;
  }

  /** Widest sphere around every bowl slot, at the largest size step a bowl ever takes. */
  function stackBounds(): THREE.Sphere {
    const box = new THREE.Box3();
    for (let i = 0; i < MEAL_BOWLS; i++) {
      const s = bowlSlot(i);
      box.expandByPoint(point.set(s.x, s.y, s.z));
    }
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    sphere.radius += localRadius(bowlGeo) * MEAL_TOP_STEP;
    return sphere;
  }

  /** The full column the wisps climb, at the fattest scale a full pot ever reaches. */
  function steamBounds(): THREE.Sphere {
    const radius = localRadius(steamGeo) * steamPose(1, STEAM_PLUMP_MAX).scale;
    return new THREE.Sphere(new THREE.Vector3(0, STEAM_TOP + STEAM_HEIGHT / 2, 0), STEAM_HEIGHT / 2 + radius);
  }

  /** The whole garden patch, sway and full height included. */
  function patchBounds(): THREE.Sphere {
    const box = new THREE.Box3();
    for (let i = 0; i < SPROUTS; i++) {
      const s = sproutSlot(i);
      box.expandByPoint(point.set(s.x, s.y, s.z));
    }
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    // A full-height sprout plus the widest sway, generously.
    sphere.radius += localRadius(sproutGeo) * 2;
    return sphere;
  }

  // The static half of every model, written once per kind. These are the coordinates B5 drew; the
  // only change is that they are now merged per material slot rather than one mesh apiece. A kind
  // is normally a single `solid` chunk — only the lantern's glowing globe needs its own unlit one.
  function chunksFor(kind: StructureKind): Array<{ slot: Slot; parts: Part[] }> {
    const parts: Part[] = [];
    switch (kind) {
      case 'woodpile': {
        parts.push({ geo: new THREE.CylinderGeometry(0.26, 0.3, 0.18, 10), color: PALETTE.trunk, pos: [0, 0.09, 0] });
        // Two rows of logs laid along x, the way a dropped stack settles.
        for (const [x, y] of [[-0.18, 0.26], [0, 0.26], [0.18, 0.26], [-0.09, 0.41], [0.09, 0.41]] as const) {
          parts.push({
            geo: new THREE.CylinderGeometry(0.075, 0.075, 0.5, 8),
            color: PALETTE.trunk,
            pos: [x, y, 0],
            rot: [0, 0, Math.PI / 2],
          });
        }
        break;
      }
      case 'pot': {
        parts.push({ geo: new THREE.TorusGeometry(0.34, 0.06, 6, 14), color: PALETTE.rock, pos: [0, 0.06, 0], rot: FLAT });
        parts.push({ geo: new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), color: PALETTE.cauldron, pos: [0, 0.2, 0], scale: [1, 0.9, 1] });
        parts.push({ geo: new THREE.CylinderGeometry(0.022, 0.022, 0.44, 6), color: PALETTE.trunk, pos: [0.2, 0.34, 0.12], rot: [0.25, 0, 0.45] });
        break;
      }
      case 'bench': {
        for (const x of [-0.3, 0.3]) {
          parts.push({ geo: new THREE.CylinderGeometry(0.07, 0.08, 0.34, 8), color: PALETTE.trunk, pos: [x, 0.17, 0] });
        }
        parts.push({ geo: new THREE.BoxGeometry(0.92, 0.07, 0.34), color: PALETTE.trunk, pos: [0, 0.37, 0] });
        break;
      }
      case 'garden': {
        parts.push({ geo: new THREE.CircleGeometry(0.62, 20), color: PALETTE.soil, pos: [0, 0.02, 0], rot: FLAT });
        break;
      }
      case 'lantern': {
        parts.push({ geo: new THREE.CylinderGeometry(0.05, 0.06, 0.95, 8), color: PALETTE.trunk, pos: [0, 0.47, 0] });
        break;
      }
      case 'feeder': {
        parts.push({ geo: new THREE.CylinderGeometry(0.05, 0.06, 0.95, 8), color: PALETTE.trunk, pos: [0, 0.35, 0] });
        parts.push({ geo: new THREE.CylinderGeometry(0.22, 0.18, 0.06, 12), color: PALETTE.rock, pos: [0, 0.73, 0] });
        for (const x of [-0.07, 0, 0.07]) {
          parts.push({ geo: new THREE.SphereGeometry(0.035, 6, 5), color: PALETTE.rock, pos: [x, 0.78, 0.02] });
        }
        break;
      }
    }
    // The lamp globe is unlit so it still glows at dusk, which rules it out of the lit chunk.
    if (kind === 'lantern') {
      return [
        { slot: 'solid', parts },
        { slot: 'lamp', parts: [{ geo: new THREE.SphereGeometry(0.11, 10, 8), color: PALETTE.sun, pos: [0, 1.02, 0] }] },
      ];
    }
    return [{ slot: 'solid', parts }];
  }

  /** Per-kind baked chunks, shared by the built model and the ghost. Baked once, on first sight. */
  function chunksOf(kind: StructureKind): Chunk[] {
    const existing = baked.get(kind);
    if (existing) return existing;
    const specs = chunksFor(kind);
    const chunks = specs.map((c) => ({ slot: c.slot, geo: bake(c.parts) }));
    // `chunksFor` builds throwaway primitives; `bake` clones them, so the sources go now.
    for (const c of specs) for (const p of c.parts) p.geo.dispose();
    baked.set(kind, chunks);
    return chunks;
  }

  const dummy = new THREE.Object3D(); // instance-matrix scratch; nothing is allocated per frame
  const point = new THREE.Vector3(); // bounds-build scratch

  /**
   * Build one structure twice from the same code path: the real model with lit materials, and
   * the identical geometry as a ghost. Returns the animated references the update loop drives.
   */
  function buildModel(kind: StructureKind, ghost: boolean): Variant {
    const root = new THREE.Group();
    // Ghost parts never cast shadows (B5).
    for (const chunk of chunksOf(kind)) {
      const mesh = new THREE.Mesh(chunk.geo, ghost ? ghostMat : chunk.slot === 'lamp' ? lampMat : solidMat);
      mesh.castShadow = !ghost;
      root.add(mesh);
    }

    let bowls: THREE.InstancedMesh | null = null;
    let steam: THREE.InstancedMesh | null = null;
    let sprouts: THREE.InstancedMesh | null = null;
    let lamp: THREE.PointLight | null = null;

    if (!ghost && kind === 'lantern') {
      // Budget: this plus the second lantern and the campfire = 3 point lights, no shadows.
      lamp = new THREE.PointLight(PALETTE.fire, LAMP_LIGHT, LAMP_RANGE, 1.4);
      lamp.position.set(0, 1.02, 0);
      root.add(lamp);
    }

    // A ghost pot shows its promise, not its contents (B5): no bowls, no steam, ever.
    if (!ghost && kind === 'pot') {
      // Both cues get bounds that contain their whole travel: the bowls never move (only the top
      // one resizes), but the wisps climb the full rise, so theirs is a capsule-sized sphere.
      bowls = cue(bowlGeo, creamMat, MEAL_BOWLS, stackBounds());
      root.add(bowls);
      steam = cue(steamGeo, steamMat, STEAM_WISPS, steamBounds());
      root.add(steam);
    }
    if (!ghost && kind === 'garden') {
      sprouts = cue(sproutGeo, sproutMat, SPROUTS, patchBounds());
      root.add(sprouts);
    }

    return { root, bowls, steam, sprouts, lamp };
  }

  function createPair(structure: Structure): Model {
    const built = buildModel(structure.kind, false);
    const ghost = buildModel(structure.kind, true);
    const yaw = faceFire(structure.pos);
    for (const variant of [built, ghost]) {
      variant.root.position.set(structure.pos.x, 0, structure.pos.z);
      variant.root.rotation.y = yaw;
      variant.root.traverse((obj) => {
        obj.userData.structureId = structure.id;
      });
      group.add(variant.root);
    }
    return { built, ghost };
  }

  return {
    group,
    update(state: GameState, timeSec: number): void {
      const meals = Math.min(Math.max(0, state.pot.meals), MEAL_BOWLS);
      const growth = Math.min(1, Math.max(0, state.gardenMs / GARDEN_PERIOD_MS));
      state.structures.forEach((structure, i) => {
        let model = models.get(structure.id);
        if (!model) {
          model = createPair(structure);
          models.set(structure.id, model);
        }
        model.built.root.visible = structure.built;
        model.ghost.root.visible = !structure.built;
        if (!structure.built) return; // ghosts are static by design

        const { bowls, steam, sprouts } = model.built;
        if (bowls) {
          // `count` is the visibility switch: bowls fill in order, so the shown ones are a prefix.
          bowls.count = meals;
          for (let k = 0; k < meals; k++) {
            const s = bowlSlot(k);
            const top = meals >= MEAL_TOP_STEP_FROM && k === meals - 1;
            dummy.position.set(s.x, s.y, s.z);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.setScalar(top ? MEAL_TOP_STEP : 1);
            dummy.updateMatrix();
            bowls.setMatrixAt(k, dummy.matrix);
          }
          bowls.instanceMatrix.needsUpdate = true;
        }
        if (steam) {
          // Thicker steam once the pot is past six: the read stays legible at a distance. Bounded
          // by `STEAM_PLUMP_MAX`, the widest case `steamBounds()` was sized for.
          const over = Math.min(meals - MEAL_STACK, MEAL_BOWLS - MEAL_STACK);
          const plump = over > 0 ? 1 + STEAM_PLUMP * over : 1;
          steam.count = meals > 0 ? STEAM_WISPS : 0;
          for (let k = 0; k < steam.count; k++) {
            const wisp = steamPose((timeSec * STEAM_RISE + k / STEAM_WISPS) % 1, plump);
            dummy.position.set(0, wisp.y, 0);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.setScalar(wisp.scale);
            dummy.updateMatrix();
            steam.setMatrixAt(k, dummy.matrix);
          }
          steam.instanceMatrix.needsUpdate = true;
        }
        if (sprouts) {
          sprouts.count = SPROUTS;
          for (let k = 0; k < SPROUTS; k++) {
            // Staggered: later sprouts start later, so the patch fills in unevenly.
            const delay = (k / SPROUTS) * 0.5;
            const t = Math.min(1, Math.max(0, (growth - delay) / (1 - delay)));
            const s = sproutSlot(k);
            dummy.position.set(s.x, s.y, s.z);
            dummy.rotation.set(0, 0, Math.sin(timeSec * 1.1 + k) * SPROUT_SWAY);
            dummy.scale.set(1, Math.max(0.04, t), Math.max(0.04, t));
            dummy.updateMatrix();
            sprouts.setMatrixAt(k, dummy.matrix);
          }
          sprouts.instanceMatrix.needsUpdate = true;
        }
        if (model.built.lamp) model.built.lamp.intensity = LAMP_LIGHT * (1 + Math.sin(timeSec * 0.9 + i) * 0.08);
      });

      const live = new Set(state.structures.map((s) => s.id));
      models.forEach((model, id) => {
        if (live.has(id)) return;
        group.remove(model.built.root, model.ghost.root);
        models.delete(id);
      });
    },
    pick(raycaster: THREE.Raycaster): string | null {
      for (const hit of raycaster.intersectObjects(group.children, true)) {
        if (!shown(hit.object)) continue; // a hidden variant must never win the hit
        const id: unknown = hit.object.userData.structureId;
        if (typeof id === 'string') return id;
      }
      return null;
    },
    dispose(): void {
      disposables.forEach((d) => d.dispose());
      disposables.length = 0;
      baked.clear();
      models.clear();
      group.clear();
    },
  };
}
