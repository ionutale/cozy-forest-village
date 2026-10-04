import './styles/tokens.css';
import './styles/ui.css';
import type { GameState } from './sim';
import { assignTask, createInitialState, tick } from './sim';
import { initRender } from './render';
import { initUI } from './ui';

declare global {
  interface Window {
    /** Testability hook from DESIGN.md §3 — lets automated checks read live sim state. */
    __cozy?: { getState: () => GameState };
  }
}

const canvas = document.getElementById('world');
const uiRoot = document.getElementById('ui');
if (!(canvas instanceof HTMLCanvasElement) || !(uiRoot instanceof HTMLElement)) {
  throw new Error('Boot failed: #world canvas and #ui root must exist');
}

const state = createInitialState();
const render = initRender(canvas);
const ui = initUI(uiRoot, {
  // UI only asks the sim to reassign; the next frame's render picks up the new state.
  assignTask: (villagerId, task) => assignTask(state, villagerId, task),
});

window.addEventListener('resize', render.resize);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(now - last, 100);
  last = now;
  tick(state, dt);
  render.render(state, dt);
  ui.render(state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__cozy = { getState: () => state };