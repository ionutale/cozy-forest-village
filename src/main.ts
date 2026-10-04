import './styles/tokens.css';
import './styles/ui.css';
import type { GameState } from './sim';
import { assignTask, buildStructure, createInitialState, tick } from './sim';
import { initRender } from './render';
import { initAudio } from './audio';
import { initUI } from './ui';
import { clearSave, loadGame, saveGame, startAutosave } from './persist';

declare global {
  interface Window {
    /** Testability hook from DESIGN.md §3 — live sim state + villager screen position. */
    __cozy?: {
      getState: () => GameState;
      projectVillager: (villagerId: string) => { x: number; y: number } | null;
    };
  }
}

const canvas = document.getElementById('world');
const uiRoot = document.getElementById('ui');
if (!(canvas instanceof HTMLCanvasElement) || !(uiRoot instanceof HTMLElement)) {
  throw new Error('Boot failed: #world canvas and #ui root must exist');
}

// B7: set by resetVillage. A reload fires the pagehide handler below, and that handler saves —
  // without this flag it would write the village straight back over the wipe.
let wiped = false;

const state = loadGame() ?? createInitialState();
const stopAutosave = startAutosave(() => state);
const render = initRender(canvas);
const audio = initAudio();
const ui = initUI(uiRoot, {
  // UI only asks the sim to reassign; the next frame's render picks up the new state.
  assignTask: (villagerId, task) => assignTask(state, villagerId, task),
  // Panel-driven selection (card click, Escape, outside click) must light up the world ring.
  onSelect: (villagerId) => render.setSelected(villagerId),
  // B7: spend resources on a ghost. The sim refuses unknown / already-built / unaffordable.
  build: (structureId) => {
    buildStructure(state, structureId);
  },
  // B7: two-step reset. Wipe the save, then reload so every layer boots from scratch.
  resetVillage: () => {
    wiped = true;
    stopAutosave();
    clearSave();
    window.location.reload();
  },
});

window.addEventListener('resize', render.resize);

/* T05 world interaction: a pointer that stays put is a click, a pointer that travels is an
   orbit drag. The threshold is deliberately small (6 px) so gentle aiming still selects,
   while any real camera drag cancels. */
const CLICK_SLOP_PX = 6;
let downX = 0;
let downY = 0;
let dragging = false;

canvas.addEventListener('pointerdown', (ev) => {
  downX = ev.clientX;
  downY = ev.clientY;
  dragging = false;
});

canvas.addEventListener('pointermove', (ev) => {
  if (!ev.buttons) return;
  if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > CLICK_SLOP_PX) dragging = true;
});

canvas.addEventListener('pointerup', (ev) => {
  const moved = Math.hypot(ev.clientX - downX, ev.clientY - downY);
  const wasDrag = dragging || moved > CLICK_SLOP_PX;
  dragging = false;
  if (wasDrag) return;
  // B7 pick order: a villager wins over a structure under the same pixel (they overlap in the
  // ring), and empty ground clears both. Exactly one of the two ids is ever non-null.
  const villagerId = render.pickVillager(ev.clientX, ev.clientY);
  const structureId = villagerId ? null : render.pickStructure(ev.clientX, ev.clientY);
  render.setSelected(villagerId);
  ui.select(villagerId);
  ui.selectStructure(structureId);
});

// Containment (M12): a throw inside one layer must not silently freeze the world. The first
// failure is logged once and the loop keeps scheduling, so the game stays observable.
let frameErrorLogged = false;
// Teardown (M12): the layers below are disposed once and never rebuilt, so the loop must stop
// scheduling or the next frame would re-create them against a disposed renderer.
let stopped = false;
let last = performance.now();
function frame(now: number): void {
  if (stopped) return;
  try {
    const dt = Math.min(now - last, 100);
    last = now;
    tick(state, dt);
    render.render(state, dt);
    audio.update(state, dt);
    ui.render(state);
  } catch (err) {
    if (!frameErrorLogged) {
      frameErrorLogged = true;
      console.error('[cozy] frame loop failed; later frame errors are not logged', err);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Tear every layer down when the page goes away: WebGL context, DOM listeners, AudioContext.
window.addEventListener('pagehide', () => {
  stopped = true; // set first, so no frame can run against a half-disposed layer
  stopAutosave();
  if (!wiped) saveGame(state); // final save before the layers go away, unless B7 just wiped it
  render.dispose();
  ui.dispose();
  audio.dispose();
});

// Restored from the back/forward cache means those layers are gone for good and cannot be
// revived. Since B3 there *is* a save, so persist before reloading — otherwise a bfcache restore
// would throw away up to one autosave interval (~3 s) of progress.
window.addEventListener('pageshow', () => {
  if (!stopped) return;
  if (!wiped) saveGame(state);
  window.location.reload();
});

window.__cozy = { getState: () => state, projectVillager: (id) => render.projectVillager(id) };