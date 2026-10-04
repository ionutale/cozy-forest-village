// Structures: one low-poly model per village structure (DESIGN §2 pillars 1–2, §3.2 catalog).
// Geometry and materials are shared across every structure *and* both variants, so an unbuilt
// spot shows the real silhouette as a ghost under a single translucent material. Lantern lamps
// are the only per-model objects. Motion is a pure function of `timeSec` + state — no Math.random,
// no timers, nothing cached in the sim.

import * as THREE from 'three';
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
const MEAL_BOWLS = 6;
const SPROUTS = 6;
const STEAM_WISPS = 3;
const LAMP_LIGHT = 0.5;
const LAMP_RANGE = 6;

type Vec3 = readonly [number, number, number];
type Rot3 = readonly [number, number, number];

interface Variant {
  root: THREE.Group;
  bowls: THREE.Mesh[];
  steam: THREE.Mesh[];
  sprouts: THREE.Mesh[];
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

export function createStructures(): StructuresLayer {
  const group = new THREE.Group();
  const models = new Map<string, Model>();
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // Shared geometry: every model draws from this one set, ghosts included.
  const stumpGeo = track(new THREE.CylinderGeometry(0.26, 0.3, 0.18, 10));
  const logGeo = track(new THREE.CylinderGeometry(0.075, 0.075, 0.5, 8));
  const seatGeo = track(new THREE.BoxGeometry(0.92, 0.07, 0.34));
  const legGeo = track(new THREE.CylinderGeometry(0.07, 0.08, 0.34, 8));
  const ringGeo = track(new THREE.TorusGeometry(0.34, 0.06, 6, 14));
  const cauldronGeo = track(new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62));
  const stirrerGeo = track(new THREE.CylinderGeometry(0.022, 0.022, 0.44, 6));
  const bowlGeo = track(new THREE.CylinderGeometry(0.085, 0.06, 0.05, 10));
  const soilGeo = track(new THREE.CircleGeometry(0.62, 20));
  const sproutGeo = track(new THREE.ConeGeometry(0.07, 0.2, 6));
  const postGeo = track(new THREE.CylinderGeometry(0.05, 0.06, 0.95, 8));
  const lampGeo = track(new THREE.SphereGeometry(0.11, 10, 8));
  const trayGeo = track(new THREE.CylinderGeometry(0.22, 0.18, 0.06, 12));
  const seedGeo = track(new THREE.SphereGeometry(0.035, 6, 5));
  const steamGeo = track(new THREE.SphereGeometry(0.07, 8, 6));

  // Shared materials. The ghost overrides all of them with one translucent sheet.
  const woodMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.trunk }));
  const stoneMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.rock }));
  const ironMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.cauldron }));
  const creamMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.flowerWhite }));
  const soilMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.soil }));
  const sproutMat = track(new THREE.MeshLambertMaterial({ color: PALETTE.tuftA }));
  const lampMat = track(new THREE.MeshBasicMaterial({ color: PALETTE.sun }));
  const steamMat = track(new THREE.MeshBasicMaterial({ color: PALETTE.mote, transparent: true, opacity: 0.32, depthWrite: false }));
  const ghostMat = track(new THREE.MeshBasicMaterial({
    color: PALETTE.flowerWhite,
    transparent: true,
    opacity: 0.22, // B5: a hint of what will stand here, never a solid preview
    depthWrite: false,
  }));

  const mat = (ghost: boolean, real: THREE.Material): THREE.Material => (ghost ? ghostMat : real);
  const FLAT: Rot3 = [-Math.PI / 2, 0, 0];

  /** One mesh into `out`. Ghost parts never cast shadows (B5). */
  function part(out: THREE.Group, geo: THREE.BufferGeometry, material: THREE.Material, pos: Vec3, rot?: Rot3): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = material !== ghostMat;
    out.add(mesh);
    return mesh;
  }

  /**
   * Build one structure twice from the same code path: the real model with lit materials, and
   * the identical geometry as a ghost. Returns the animated references the update loop drives.
   */
  function buildModel(kind: StructureKind, ghost: boolean): Variant {
    const root = new THREE.Group();
    const bowls: THREE.Mesh[] = [];
    const steam: THREE.Mesh[] = [];
    const sprouts: THREE.Mesh[] = [];
    let lamp: THREE.PointLight | null = null;
    const wood = mat(ghost, woodMat);
    const stone = mat(ghost, stoneMat);

    switch (kind) {
      case 'woodpile': {
        part(root, stumpGeo, wood, [0, 0.09, 0]);
        // Two rows of logs laid along x, the way a dropped stack settles.
        for (const [x, y] of [[-0.18, 0.26], [0, 0.26], [0.18, 0.26], [-0.09, 0.41], [0.09, 0.41]] as const) {
          part(root, logGeo, wood, [x, y, 0], [0, 0, Math.PI / 2]);
        }
        break;
      }
      case 'pot': {
        part(root, ringGeo, stone, [0, 0.06, 0], FLAT);
        const pot = part(root, cauldronGeo, mat(ghost, ironMat), [0, 0.2, 0]);
        pot.scale.set(1, 0.9, 1);
        part(root, stirrerGeo, wood, [0.2, 0.34, 0.12], [0.25, 0, 0.45]);
        for (let i = 0; i < MEAL_BOWLS; i++) bowls.push(part(root, bowlGeo, mat(ghost, creamMat), [0.46, 0.035 + i * 0.055, 0.2]));
        for (let i = 0; i < STEAM_WISPS; i++) steam.push(part(root, steamGeo, mat(ghost, steamMat), [0, 0.5, 0]));
        break;
      }
      case 'bench': {
        part(root, legGeo, wood, [-0.3, 0.17, 0]);
        part(root, legGeo, wood, [0.3, 0.17, 0]);
        part(root, seatGeo, wood, [0, 0.37, 0]);
        break;
      }
      case 'garden': {
        part(root, soilGeo, mat(ghost, soilMat), [0, 0.02, 0], FLAT);
        for (let i = 0; i < SPROUTS; i++) {
          const x = (i % 3) - 1;
          sprouts.push(part(root, sproutGeo, mat(ghost, sproutMat), [x * 0.3, 0.12, i < 3 ? -0.17 : 0.17]));
        }
        break;
      }
      case 'lantern': {
        part(root, postGeo, wood, [0, 0.47, 0]);
        part(root, lampGeo, mat(ghost, lampMat), [0, 1.02, 0]);
        if (!ghost) {
          // Budget: this plus the second lantern and the campfire = 3 point lights, no shadows.
          lamp = new THREE.PointLight(PALETTE.fire, LAMP_LIGHT, LAMP_RANGE, 1.4);
          lamp.position.set(0, 1.02, 0);
          root.add(lamp);
        }
        break;
      }
      case 'feeder': {
        part(root, postGeo, wood, [0, 0.35, 0]);
        part(root, trayGeo, stone, [0, 0.73, 0]);
        for (const x of [-0.07, 0, 0.07]) part(root, seedGeo, stone, [x, 0.78, 0.02]);
        break;
      }
    }

    if (ghost) {
      // A ghost pot shows its promise, not its contents.
      for (const mesh of [...bowls, ...steam]) mesh.visible = false;
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
        if (obj instanceof THREE.Mesh) obj.userData.structureId = structure.id;
      });
      group.add(variant.root);
    }
    return { built, ghost };
  }

  return {
    group,
    update(state: GameState, timeSec: number): void {
      const meals = Math.min(state.pot.meals, MEAL_BOWLS);
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
        if (model.built.bowls.length) model.built.bowls.forEach((bowl, k) => { bowl.visible = k < meals; });
        if (model.built.steam.length) {
          model.built.steam.forEach((wisp, k) => {
            wisp.visible = meals > 0;
            if (!wisp.visible) return;
            const rise = (timeSec * 0.35 + k / model.built.steam.length) % 1;
            wisp.position.y = 0.5 + rise * 0.55;
            wisp.scale.setScalar(0.55 + rise * 0.85);
          });
        }
        if (model.built.sprouts.length) {
          model.built.sprouts.forEach((sprout, k) => {
            // Staggered: later sprouts start later, so the patch fills in unevenly.
            const delay = (k / model.built.sprouts.length) * 0.5;
            const t = Math.min(1, Math.max(0, (growth - delay) / (1 - delay)));
            sprout.scale.set(1, Math.max(0.04, t), Math.max(0.04, t));
            sprout.rotation.z = Math.sin(timeSec * 1.1 + k) * 0.05;
          });
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
      models.clear();
      group.clear();
    },
  };
}