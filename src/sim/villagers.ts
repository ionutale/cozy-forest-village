// Fixed villager roster and spawn ring (DESIGN.md §3 roster; T1 stub approach).

import type { Villager } from './types';

const TAU = Math.PI * 2;

const ROSTER: ReadonlyArray<{ name: string; hatColor: string }> = [
  { name: 'Maple', hatColor: '#c96f4a' },
  { name: 'Birch', hatColor: '#7fa653' },
  { name: 'Fern', hatColor: '#b0577a' },
  { name: 'Pip', hatColor: '#6f8fb0' },
  { name: 'Hazel', hatColor: '#d9a441' },
  { name: 'Juniper', hatColor: '#8a6fae' },
  { name: 'Moss', hatColor: '#4e8f76' },
  { name: 'Clover', hatColor: '#b0724b' },
];

export function makeVillagers(rnd: () => number): Villager[] {
  return ROSTER.map((entry, i) => {
    const angle = (i / ROSTER.length) * TAU + rnd() * 0.4;
    const radius = 2.4 + rnd() * 1.8;
    return {
      id: `v${i + 1}`,
      name: entry.name,
      hatColor: entry.hatColor,
      task: null,
      state: 'idle',
      pos: { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius },
      facing: 0,
      targetNodeId: null,
      progressMs: 0,
    };
  });
}
