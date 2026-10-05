import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GameState } from '../sim';
import { PALETTE } from './palette';
import { createEnvironment, type Environment } from './environment';
import { createAmbient, type AmbientLayer } from './ambient';
import { createStructures, type StructuresLayer } from './structures';
import { createVillagers, type VillagersLayer } from './villagers';

export interface RenderHandle {
  render(state: GameState, dtMs: number): void;
  resize(): void;
  dispose(): void;
  /** Screen-space hit test against villager meshes (client px). */
  pickVillager(clientX: number, clientY: number): string | null;
  /** Soft selection ring under a villager; null clears it. */
  setSelected(villagerId: string | null): void;
  /** Project a villager to screen client px (testability + UI anchoring). */
  projectVillager(villagerId: string): { x: number; y: number } | null;
  /** B5: screen-space hit test against structure meshes (built or ghost). */
  pickStructure(clientX: number, clientY: number): string | null;
  /** A4: hover cue — true when the pixel is over a villager (checked first) or a structure.
      Read-only: same raycasts as the click chain, no selection or camera side effects. */
  pickHover(clientX: number, clientY: number): boolean;
}

declare global {
  interface Window {
    __cozyRender?: { info: () => { calls: number; triangles: number; geometries: number; textures: number } };
  }
}

function disposeScene(scene: THREE.Scene): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    geometries.add(obj.geometry);
    if (Array.isArray(obj.material)) obj.material.forEach((m) => materials.add(m));
    else materials.add(obj.material);
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

export function initRender(canvas: HTMLCanvasElement): RenderHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(PALETTE.sky);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.fog, 30, 95);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(16, 14, 16);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 10;
  controls.maxDistance = 45;
  controls.maxPolarAngle = 1.35;
  controls.target.set(0, 0, 0);
  controls.update();

  const ambient = new THREE.HemisphereLight(PALETTE.ambientSky, PALETTE.ambientGround, 0.8);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(PALETTE.sun, 1.6);
  sun.position.set(18, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(60, 64),
    new THREE.MeshLambertMaterial({ color: PALETTE.grass }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  let env: Environment | null = null;
  let villagers: VillagersLayer | null = null;
  let ambientLayer: AmbientLayer | null = null;
  let structures: StructuresLayer | null = null;
  let selectedId: string | null = null; // kept here so the ring survives layer re-creation
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const scratch = new THREE.Vector2();

  function resize(): void {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  resize();

  window.__cozyRender = {
    info: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
    }),
  };

  return {
    render(state: GameState, dtMs: number): void {
      if (!env) {
        env = createEnvironment(state.nodes);
        scene.add(env.group);
      }
      if (!villagers) {
        villagers = createVillagers();
        scene.add(villagers.group);
      }
      if (!ambientLayer) {
        ambientLayer = createAmbient();
        scene.add(ambientLayer.group);
      }
      if (!structures) {
        structures = createStructures();
        scene.add(structures.group);
      }
      const timeSec = performance.now() / 1000;
      // B4's Environment takes the live fire state; without it the flame falls back to the
      // `__cozy` hook, so pass the real thing.
      env.update(timeSec, state.fire);
      villagers.update(state, timeSec, dtMs);
      ambientLayer.update(state, timeSec, dtMs);
      structures.update(state, timeSec);
      villagers.setSelected(selectedId);
      controls.update();
      renderer.render(scene, camera);
    },
    resize,
    pickVillager(clientX: number, clientY: number): string | null {
      if (!villagers) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return villagers.pick(raycaster);
    },
    setSelected(villagerId: string | null): void {
      selectedId = villagerId;
      villagers?.setSelected(selectedId);
    },
    pickStructure(clientX: number, clientY: number): string | null {
      if (!structures) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return structures.pick(raycaster);
    },
    pickHover(clientX: number, clientY: number): boolean {
      if (!villagers && !structures) return false;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      // Same precedence as the click chain in main.ts: a villager wins over a structure.
      return villagers?.pick(raycaster) != null || structures?.pick(raycaster) != null;
    },
    projectVillager(villagerId: string): { x: number; y: number } | null {
      if (!villagers || !villagers.project(villagerId, camera, scratch)) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + (scratch.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-scratch.y * 0.5 + 0.5) * rect.height,
      };
    },
    dispose(): void {
      env?.dispose();
      env = null;
      villagers?.dispose();
      villagers = null;
      ambientLayer?.dispose();
      ambientLayer = null;
      structures?.dispose();
      structures = null;
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
      delete window.__cozyRender;
    },
  };
}
