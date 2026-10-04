import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GameState } from '../sim';
import { PALETTE } from './palette';
import { createEnvironment, type Environment } from './environment';
import { createVillagers, type VillagersLayer } from './villagers';

export interface RenderHandle {
  render(state: GameState, dtMs: number): void;
  resize(): void;
  dispose(): void;
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
      const timeSec = performance.now() / 1000;
      env.update(timeSec);
      villagers.update(state, timeSec, dtMs);
      controls.update();
      renderer.render(scene, camera);
    },
    resize,
    dispose(): void {
      env?.dispose();
      env = null;
      villagers?.dispose();
      villagers = null;
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
      delete window.__cozyRender;
    },
  };
}
