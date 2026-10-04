import { describe, expect, it } from 'vitest';
import { assignTask, createInitialState } from './index';

describe('createInitialState', () => {
  it('builds the fixed roster, node counts and zeroed counters', () => {
    const state = createInitialState();

    expect(state.tick).toBe(0);
    expect(state.seed).toBe(1);
    expect(state.resources).toEqual({ wood: 0, berries: 0 });
    expect(state.villagers.map((v) => v.name)).toEqual([
      'Maple',
      'Birch',
      'Fern',
      'Pip',
      'Hazel',
      'Juniper',
      'Moss',
      'Clover',
    ]);
    expect(state.villagers.every((v) => v.task === null && v.state === 'idle')).toBe(true);
    expect(state.nodes.filter((n) => n.kind === 'tree')).toHaveLength(40);
    expect(state.nodes.filter((n) => n.kind === 'bush')).toHaveLength(20);

    const campfire = state.nodes.find((n) => n.kind === 'campfire');
    expect(campfire?.pos).toEqual({ x: 0, z: 0 });

    const scatter = state.nodes.filter((n) => n.kind !== 'campfire');
    expect(scatter.every((n) => Math.hypot(n.pos.x, n.pos.z) >= 6 && Math.hypot(n.pos.x, n.pos.z) <= 28)).toBe(true);
    // Layout is seeded, so the same seed always produces the same village.
    const repeat = createInitialState().nodes.filter((n) => n.kind !== 'campfire');
    expect(repeat.map((n) => n.pos)).toEqual(scatter.map((n) => n.pos));
  });
});

describe('assignTask', () => {
  it('sets and clears a villager task, ignoring unknown ids', () => {
    const state = createInitialState();
    const first = state.villagers[0];

    assignTask(state, 'v1', 'chop');
    expect(state.villagers.find((v) => v.id === 'v1')?.task).toBe('chop');
    expect(first?.task).toBe('chop');

    assignTask(state, 'v1', null);
    expect(state.villagers.find((v) => v.id === 'v1')?.task).toBeNull();

    expect(() => assignTask(state, 'nope', 'rest')).not.toThrow();
    expect(state.villagers.every((v) => v.task === null)).toBe(true);
  });
});