import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GameState, ResourceNode } from '../sim';
import { PALETTE } from './palette';

export interface RenderHandle {
  render(state: GameState, dtMs: number): void;
  resize(): void;
  dispose(): void;
}

const TRUNK_H = 1.6;
const CROWN_H = 1.9;

/**
 * Shared geometry and materials for the placeholder world. Every tree reuses the same
 * three meshes' data, so the scene stays cheap until T3 swaps in InstancedMeshes.
 */
interface WorldKit {
  trunkGeo: THREE.CylinderGeometry;
  crownGeo: THREE.ConeGeometry;
  bushGeo: THREE.SphereGeometry;
  stoneGeo: THREE.TorusGeometry;
  flameGeo: THREE.ConeGeometry;
  bark: THREE.MeshLambertMaterial;
  foliageA: THREE.MeshLambertMaterial;
  foliageB: THREE.MeshLambertMaterial;
  stone: THREE.MeshLambertMaterial;
  flame: THREE.MeshBasicMaterial;
}

function createKit(): WorldKit {
  return {
    trunkGeo: new THREE.CylinderGeometry(0.26, 0.36, TRUNK_H, 7),
    crownGeo: new THREE.ConeGeometry(0.95, CROWN_H, 8),
    bushGeo: new THREE.SphereGeometry(0.55, 10, 7),
    stoneGeo: new THREE.TorusGeometry(0.92, 0.16, 6, 14),
    flameGeo: new THREE.ConeGeometry(0.4, 1.05, 8),
    bark: new THREE.MeshLambertMaterial({ color: PALETTE.trunk }),
    foliageA: new THREE.MeshLambertMaterial({ color: PALETTE.foliageA }),
    foliageB: new THREE.MeshLambertMaterial({ color: PALETTE.foliageB }),
    stone: new THREE.MeshLambertMaterial({ color: '#9c9182' }),
    flame: new THREE.MeshBasicMaterial({ color: PALETTE.fire }),
  };
}

function addTree(world: THREE.Group, node: ResourceNode, kit: WorldKit, turn: number): void {
  const { x, z } = node.pos;
  const trunk = new THREE.Mesh(kit.trunkGeo, kit.bark);
  trunk.position.set(x, TRUNK_H / 2, z);
  trunk.rotation.y = turn;
  trunk.castShadow = true;

  const lower = new THREE.Mesh(kit.crownGeo, kit.foliageA);
  lower.position.set(x, TRUNK_H + CROWN_H / 2, z);
  lower.rotation.y = turn;
  lower.castShadow = true;

  const upper = new THREE.Mesh(kit.crownGeo, kit.foliageB);
  upper.position.set(x, TRUNK_H + CROWN_H / 2 + 1.05, z);
  upper.rotation.y = turn + 0.6;
  upper.scale.setScalar(0.7);
  upper.castShadow = true;

  world.add(trunk, lower, upper);
}

function addBush(world: THREE.Group, node: ResourceNode, kit: WorldKit): void {
  const bush = new THREE.Mesh(kit.bushGeo, kit.foliageB);
  bush.position.set(node.pos.x, 0.4, node.pos.z);
  bush.scale.set(1, 0.72, 1);
  bush.castShadow = true;
  world.add(bush);
}

function addCampfire(world: THREE.Group, node: ResourceNode, kit: WorldKit): void {
  const ring = new THREE.Mesh(kit.stoneGeo, kit.stone);
  ring.position.set(node.pos.x, 0.14, node.pos.z);
  ring.rotation.x = -Math.PI / 2;
  ring.castShadow = true;

  const flame = new THREE.Mesh(kit.flameGeo, kit.flame);
  flame.position.set(node.pos.x, 0.6, node.pos.z);
  world.add(ring, flame);
}

function buildPlaceholderWorld(nodes: ReadonlyArray<ResourceNode>, world: THREE.Group, kit: WorldKit): void {
  nodes.forEach((node, i) => {
    if (node.kind === 'tree') addTree(world, node, kit, i * 0.7);
    else if (node.kind === 'bush') addBush(world, node, kit);
    else addCampfire(world, node, kit);
  });
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
  // three 0.186 removed PCFSoftShadowMap, so PCFShadowMap is the supported soft-ish filter
  // and keeps the console clean; T3 owns the final lighting setup.
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

  const kit = createKit();
  const world = new THREE.Group();
  scene.add(world);
  let worldBuilt = false;

  function resize(): void {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  resize();

  return {
    render(state: GameState, _dtMs: number): void {
      if (!worldBuilt) {
        buildPlaceholderWorld(state.nodes, world, kit);
        worldBuilt = true;
      }
      controls.update();
      renderer.render(scene, camera);
    },
    resize,
    dispose(): void {
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
    },
  };
}