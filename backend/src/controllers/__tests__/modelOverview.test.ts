/**
 * buildModelOverview() gathers a whole-model snapshot (packages → entities +
 * concept counts) and formatModelOutline() renders the compact text injected
 * into the system prompt each turn.
 */
jest.mock('../../utils/fileOperations.js', () => ({
  listMicroservices: jest.fn(),
}));

import { buildModelOverview, formatModelOutline } from '../aiController.js';
import { listMicroservices } from '../../utils/fileOperations.js';

const mockListMicroservices = listMicroservices as jest.MockedFunction<any>;

function makeServices(over: any = {}) {
  return {
    serviceService: {
      getServiceEntities: jest.fn(async (pkg: string) =>
        pkg === 'catalog'
          ? [{ name: 'Product' }, { name: 'Category' }]
          : [{ name: 'Order' }, { name: 'OrderLine' }, { name: 'Customer' }]),
      getPackageRelationships: jest.fn(async (pkg: string) => (pkg === 'catalog' ? [{}] : [{}, {}])),
    },
    caseService: { getAll: jest.fn(async () => [{ name: 'Checkout' }]) },
    ruleService: { listRules: jest.fn(async () => [{ name: 'r1' }, { name: 'r2' }]) },
    eventService: { list: jest.fn(async () => [{ name: 'OrderPlaced' }]) },
    actionService: { list: jest.fn(async () => [{ name: 'PlaceOrder' }]) },
    stateMachineService: { list: jest.fn(async () => [{ name: 'OrderLifecycle' }]) },
    derivedTypes: { list: jest.fn(async () => [{ name: 'email' }, { name: 'money' }]) },
    stereotypeService: { getAllStereotypes: jest.fn(async () => [{ id: 'aggregate-root' }, { id: 'value-object' }]) },
    ...over,
  };
}

describe('buildModelOverview', () => {
  beforeEach(() => jest.clearAllMocks());

  it('aggregates packages → entities and counts every concept', async () => {
    mockListMicroservices.mockResolvedValue(['catalog', 'ordering']);
    const o = await buildModelOverview(makeServices());

    expect(o.totals).toEqual({
      packages: 2, entities: 5, relationships: 3,
      cases: 1, rules: 2, events: 1, actions: 1, stateMachines: 1,
      derivedTypes: 2, stereotypes: 2,
    });
    expect(o.packages).toEqual([
      { name: 'catalog', entities: ['Product', 'Category'], relationships: 1 },
      { name: 'ordering', entities: ['Order', 'OrderLine', 'Customer'], relationships: 2 },
    ]);
    expect(o.stereotypes).toEqual(['aggregate-root', 'value-object']);
    expect(o.derivedTypes).toEqual(['email', 'money']);
    expect(o.cases).toEqual(['Checkout']);
  });

  it('degrades a failing slice to empty instead of throwing', async () => {
    mockListMicroservices.mockResolvedValue(['catalog', 'ordering']);
    const services = makeServices({
      ruleService: { listRules: jest.fn(async () => { throw new Error('boom'); }) },
    });
    const o = await buildModelOverview(services);
    expect(o.totals.rules).toBe(0);
    expect(o.totals.entities).toBe(5); // other slices still gathered
  });

  it('handles an empty project', async () => {
    mockListMicroservices.mockResolvedValue([]);
    const services = makeServices({
      caseService: { getAll: jest.fn(async () => []) },
      ruleService: { listRules: jest.fn(async () => []) },
      eventService: { list: jest.fn(async () => []) },
      actionService: { list: jest.fn(async () => []) },
      stateMachineService: { list: jest.fn(async () => []) },
      derivedTypes: { list: jest.fn(async () => []) },
      stereotypeService: { getAllStereotypes: jest.fn(async () => []) },
    });
    const o = await buildModelOverview(services);
    expect(o.totals.packages).toBe(0);
    expect(o.packages).toEqual([]);
  });
});

describe('formatModelOutline', () => {
  it('renders a snapshot line, package list, and concept lists', () => {
    const text = formatModelOutline({
      totals: { packages: 2, entities: 5, relationships: 3, cases: 1, rules: 2, events: 1, actions: 1, stateMachines: 1, derivedTypes: 2, stereotypes: 2 },
      packages: [
        { name: 'catalog', entities: ['Product', 'Category'], relationships: 1 },
        { name: 'ordering', entities: ['Order', 'OrderLine', 'Customer'], relationships: 2 },
      ],
      stereotypes: ['aggregate-root', 'value-object'],
      derivedTypes: ['email', 'money'],
      cases: ['Checkout'],
    });
    expect(text).toMatch(/Current model snapshot — 2 package\(s\), 5 entities/);
    expect(text).toMatch(/- catalog: Product, Category/);
    expect(text).toMatch(/- ordering: Order, OrderLine, Customer/);
    expect(text).toMatch(/stereotypes: aggregate-root, value-object/);
    expect(text).toMatch(/cases: Checkout/);
  });

  it('reports an empty model plainly', () => {
    const text = formatModelOutline({
      totals: { packages: 0, entities: 0, relationships: 0, cases: 0, rules: 0, events: 0, actions: 0, stateMachines: 0, derivedTypes: 0, stereotypes: 0 },
      packages: [], stereotypes: [], derivedTypes: [], cases: [],
    });
    expect(text).toMatch(/empty/i);
  });
});
