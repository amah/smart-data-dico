/**
 * generateMermaidDiagram() converts the model to Mermaid source for each
 * diagram option (er / class / state / flow).
 */
jest.mock('../../utils/fileOperations.js', () => ({
  listMicroservices: jest.fn(),
}));

import { generateMermaidDiagram } from '../aiMermaid.js';
import { listMicroservices } from '../../utils/fileOperations.js';

const mockListMicroservices = listMicroservices as jest.MockedFunction<any>;

const PRODUCT = 'p-uuid';
const CATEGORY = 'c-uuid';
const ORDER = 'o-uuid';

function makeServices(over: any = {}) {
  return {
    serviceService: {
      getServiceEntities: jest.fn(async (pkg: string) => pkg === 'catalog' ? [
        { uuid: PRODUCT, name: 'Product', stereotype: 'aggregate-root', attributes: [
          { name: 'id', type: 'uuid', primaryKey: true }, { name: 'sku', type: 'string' }] },
        { uuid: CATEGORY, name: 'Category', attributes: [{ name: 'id', type: 'uuid', primaryKey: true }] },
      ] : [{ uuid: ORDER, name: 'Order', attributes: [{ name: 'id', type: 'uuid', primaryKey: true }] }]),
      getPackageRelationships: jest.fn(async (pkg: string) => pkg === 'catalog' ? [
        { source: { entity: CATEGORY, cardinality: 'one' }, target: { entity: PRODUCT, cardinality: 'many' }, description: 'contains' },
      ] : []),
    },
    stateMachineService: { list: jest.fn(async () => [{
      name: 'OrderLifecycle', initialState: 'PENDING',
      states: [{ name: 'PENDING' }, { name: 'PAID' }, { name: 'CANCELLED', terminal: true }],
      transitions: [
        { from: 'PENDING', to: 'PAID', on: 'pay' },
        { from: '*', to: 'CANCELLED', on: 'cancel' },
      ],
    }]) },
    actionService: { list: jest.fn(async () => [
      { uuid: 'a1', name: 'PlaceOrder', actionKind: 'command', flow: [
        { kind: 'emitEvent', name: 'OrderPlaced' }, { kind: 'wait', for: 'PaymentRequested' }] },
    ]) },
    eventService: { list: jest.fn(async () => [{ name: 'OrderPlaced' }, { name: 'PaymentRequested' }]) },
    ...over,
  };
}

describe('generateMermaidDiagram', () => {
  beforeEach(() => { jest.clearAllMocks(); mockListMicroservices.mockResolvedValue(['catalog', 'ordering']); });

  it('er: entity blocks with PK + crow’s-foot relationship', async () => {
    const r = await generateMermaidDiagram({ diagram: 'er', packageName: 'catalog' } as any, makeServices());
    expect('mermaid' in r).toBe(true);
    if ('mermaid' in r) {
      expect(r.mermaid).toMatch(/^erDiagram/);
      expect(r.mermaid).toMatch(/Product \{[\s\S]*uuid id PK/);
      // Category (one) → Product (many): ||--o{
      expect(r.mermaid).toMatch(/Category \|\|--o\{ Product : contains/);
    }
  });

  it('class: typed members, stereotype, and multiplicity association', async () => {
    const r = await generateMermaidDiagram({ diagram: 'class', packageName: 'catalog' } as any, makeServices());
    if ('mermaid' in r) {
      expect(r.mermaid).toMatch(/^classDiagram/);
      expect(r.mermaid).toMatch(/class Product \{[\s\S]*<<aggregate.root>>[\s\S]*\+uuid id/);
      expect(r.mermaid).toMatch(/Category "1" --> "\*" Product : contains/);
    }
  });

  it('state: initial, transitions (wildcard expanded), and terminal', async () => {
    const r = await generateMermaidDiagram({ diagram: 'state', entityName: 'Order' } as any, makeServices());
    if ('mermaid' in r) {
      expect(r.mermaid).toMatch(/^stateDiagram-v2/);
      expect(r.mermaid).toMatch(/\[\*\] --> PENDING/);
      expect(r.mermaid).toMatch(/PENDING --> PAID : pay/);
      // "*" expands to each non-target state → PENDING and PAID transition to CANCELLED on cancel
      expect(r.mermaid).toMatch(/PENDING --> CANCELLED : cancel/);
      expect(r.mermaid).toMatch(/PAID --> CANCELLED : cancel/);
      expect(r.mermaid).toMatch(/CANCELLED --> \[\*\]/);
    }
  });

  it('flow: action emits an event and reacts to another', async () => {
    const r = await generateMermaidDiagram({ diagram: 'flow', packageName: 'ordering' } as any, makeServices());
    if ('mermaid' in r) {
      expect(r.mermaid).toMatch(/^flowchart LR/);
      expect(r.mermaid).toMatch(/A_PlaceOrder\["PlaceOrder \(command\)"\]/);
      expect(r.mermaid).toMatch(/A_PlaceOrder -->\|emits\| E_OrderPlaced/);
      expect(r.mermaid).toMatch(/E_PaymentRequested -->\|triggers\| A_PlaceOrder/);
    }
  });

  it('state: errors when entityName is missing', async () => {
    const r = await generateMermaidDiagram({ diagram: 'state' } as any, makeServices());
    expect('error' in r).toBe(true);
  });

  it('er: errors when there are no entities', async () => {
    mockListMicroservices.mockResolvedValue([]);
    const r = await generateMermaidDiagram({ diagram: 'er' } as any, makeServices({
      serviceService: { getServiceEntities: jest.fn(async () => []), getPackageRelationships: jest.fn(async () => []) },
    }));
    expect('error' in r).toBe(true);
  });
});
