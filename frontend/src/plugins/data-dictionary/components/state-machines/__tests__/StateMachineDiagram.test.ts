import { describe, expect, it } from 'vitest';
import type { StateMachine } from '../../../../../types';
import { stateMachineToElements } from '../StateMachineDiagram';

const machine: StateMachine = {
  uuid: 'sm-order',
  name: 'order',
  ownerRef: 'entity-order',
  initialState: 'PENDING',
  states: [
    { name: 'PENDING' },
    { name: 'PROCESSING' },
    { name: 'DONE', terminal: true },
    { name: 'CANCELLED', terminal: true },
  ],
  transitions: [
    { uuid: 'advance', from: 'PENDING', to: 'PROCESSING', on: 'advance' },
    { uuid: 'cancel', from: '*', to: 'CANCELLED', on: 'cancel', guard: 'active' },
  ],
};

describe('stateMachineToElements', () => {
  it('expands wildcard transitions from non-terminal states only', () => {
    const edges = stateMachineToElements(machine).filter(element => element.data.source);

    expect(edges.map(edge => edge.data.source)).toEqual(['PENDING', 'PENDING', 'PROCESSING']);
    expect(edges.some(edge => edge.data.source === 'DONE')).toBe(false);
  });

  it('shows a wildcard transition label once to avoid overlapping duplicates', () => {
    const wildcardEdges = stateMachineToElements(machine)
      .filter(element => String(element.data.id).startsWith('cancel-'));

    expect(wildcardEdges.map(edge => edge.data.label)).toEqual(['cancel [active]', '']);
  });
});
