/**
 * Shared executors for the getEntityDetails / listEntities AI tools
 * (#grounding). executeGetEntityDetails resolves an entity name ACROSS
 * packages when packageName is omitted or wrong: one match → full details,
 * several → a disambiguation list (not an error), none → an error steering
 * to searchModel. executeListEntities turns an unknown package into the same
 * searchModel steering instead of a silent empty list.
 *
 * The precedence semantics of serviceService.findEntityMatches itself
 * (preferred-package-wins, full scan otherwise) are covered against real
 * storage in services/__tests__/serviceService.findEntityMatches.test.ts —
 * the fake here mirrors that contract.
 */
jest.mock('../../utils/fileOperations.js', () => ({
  listMicroservices: jest.fn(),
}));

import { executeGetEntityDetails, executeListEntities } from '../aiController.js';
import { listMicroservices } from '../../utils/fileOperations.js';

const mockListMicroservices = listMicroservices as jest.MockedFunction<any>;

const PACKAGES: Record<string, any[]> = {
  'order-service': [
    {
      uuid: 'o1', name: 'Order', description: 'A customer order',
      metadata: [{ name: 'physical.tableName', value: 'orders' }],
      attributes: [
        { name: 'id', type: 'uuid', required: true, primaryKey: true },
        { name: 'orderNumber', type: 'string', required: true },
      ],
    },
  ],
  'customer-service': [
    {
      uuid: 'c1', name: 'Customer', description: 'A person who buys',
      attributes: [{ name: 'id', type: 'uuid', required: true, primaryKey: true }, { name: 'email', type: 'string' }],
    },
  ],
  'billing-service': [
    {
      uuid: 'inv1', name: 'Invoice', description: 'A bill',
      attributes: [{ name: 'id', type: 'uuid', required: true, primaryKey: true }],
    },
    {
      uuid: 'c2', name: 'Customer', description: 'Billing account party',
      attributes: [
        { name: 'id', type: 'uuid', required: true, primaryKey: true },
        { name: 'invoiceRef', type: 'string' },
        { name: 'vatNumber', type: 'string' },
      ],
    },
  ],
};

/** Faithful fake of serviceService.findEntityMatches (preferred hit wins outright). */
function makeServices() {
  return {
    serviceService: {
      findEntityMatches: jest.fn(async (entityName: string, preferredPackage?: string) => {
        if (preferredPackage) {
          const hit = (PACKAGES[preferredPackage] ?? []).find(e => e.name === entityName);
          if (hit) return [{ entity: hit, packageName: preferredPackage }];
        }
        const out: Array<{ entity: any; packageName: string }> = [];
        for (const [pkg, ents] of Object.entries(PACKAGES)) {
          if (pkg === preferredPackage) continue;
          const e = ents.find(x => x.name === entityName);
          if (e) out.push({ entity: e, packageName: pkg });
        }
        return out;
      }),
      getServiceEntities: jest.fn(async (pkg: string) => PACKAGES[pkg] ?? []),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListMicroservices.mockResolvedValue(Object.keys(PACKAGES));
});

describe('executeGetEntityDetails', () => {
  it('packageName omitted + unique match → full details with the resolved package named', async () => {
    const services = makeServices();
    const r: any = await executeGetEntityDetails({ entityName: 'Invoice', format: 'json' }, services);
    expect(r.error).toBeUndefined();
    expect(r.ambiguous).toBeUndefined();
    expect(r.name).toBe('Invoice');
    expect(r.description).toBe('A bill');
    expect(r.attributes).toHaveLength(1);
    // the resolved packageName is surfaced both structurally and in the summary line
    expect(r.packageName).toBe('billing-service');
    expect(r.summary).toContain('(billing-service)');
    expect(services.serviceService.findEntityMatches).toHaveBeenCalledWith('Invoice', undefined);
  });

  it('packageName omitted + multiple matches → disambiguation list, NOT an error', async () => {
    const r: any = await executeGetEntityDetails({ entityName: 'Customer', format: 'json' }, makeServices());
    expect(r.error).toBeUndefined();
    expect(r.ambiguous).toBe(true);
    expect(r.candidates).toEqual(expect.arrayContaining([
      { entityName: 'Customer', packageName: 'customer-service', description: 'A person who buys' },
      { entityName: 'Customer', packageName: 'billing-service', description: 'Billing account party' },
    ]));
    expect(r.candidates).toHaveLength(2);
    // steers the model to retry with packageName
    expect(String(r.note)).toContain('packageName');
  });

  it('packageName given + entity found there → THAT package wins even when the name exists elsewhere', async () => {
    const r: any = await executeGetEntityDetails(
      { entityName: 'Customer', packageName: 'billing-service', format: 'json' }, makeServices());
    expect(r.ambiguous).toBeUndefined();
    expect(r.summary).toContain('(billing-service)');
    // it is the billing entity, not the customer-service one
    expect(r.attributes.map((a: any) => a.name)).toContain('invoiceRef');
    expect(r.description).toBe('Billing account party');
  });

  it('packageName given but entity NOT there → falls back and resolves to the owning package', async () => {
    const r: any = await executeGetEntityDetails(
      { entityName: 'Order', packageName: 'customer-service', format: 'json' }, makeServices());
    expect(r.error).toBeUndefined();
    expect(r.name).toBe('Order');
    expect(r.packageName).toBe('order-service');
    expect(r.summary).toContain('(order-service)');
  });

  it('zero matches anywhere → error naming searchModel with the exact call to make', async () => {
    const r: any = await executeGetEntityDetails({ entityName: 'Ghost', format: 'json' }, makeServices());
    expect(r.error).toContain("searchModel({ query: 'Ghost' })");
    expect(r.error).toContain("Entity 'Ghost' not found");
  });

  it('zero matches with a packageName hint → error mentions both the package and the global miss', async () => {
    const r: any = await executeGetEntityDetails(
      { entityName: 'Ghost', packageName: 'order-service', format: 'json' }, makeServices());
    expect(r.error).toContain("package 'order-service' or ");
    expect(r.error).toContain('searchModel');
  });

  it('rejects a missing entityName', async () => {
    const r: any = await executeGetEntityDetails({ entityName: '', format: 'json' } as any, makeServices());
    expect(r.error).toBe('entityName is required.');
  });

  it('returns compact Markdown by default', async () => {
    const r = await executeGetEntityDetails({ entityName: 'Order' }, makeServices());
    expect(typeof r).toBe('string');
    expect(r).toContain('# Order — `order-service`');
    expect(r).toContain('| `id` | `uuid` | PK, required |');
    expect(r).not.toContain('"attributes"');
  });
});

describe('executeListEntities', () => {
  it('unknown package → error steering to searchModel (not a silent empty list)', async () => {
    const r: any = await executeListEntities({ packageName: 'nope-service' }, makeServices());
    expect(r.entities).toBeUndefined();
    expect(r.error).toContain("Package 'nope-service' not found");
    expect(r.error).toContain('searchModel');
    // names the known packages so the model can self-correct
    expect(r.error).toContain('order-service');
  });

  it('known package → the entity list with name/description/attrCount', async () => {
    const r: any = await executeListEntities({ packageName: 'billing-service' }, makeServices());
    expect(r.error).toBeUndefined();
    expect(r.entities).toEqual([
      { name: 'Invoice', description: 'A bill', attrCount: 1 },
      { name: 'Customer', description: 'Billing account party', attrCount: 3 },
    ]);
    expect(r.summary).toContain('billing-service');
  });

  it('bounds large package listings and supports a query filter', async () => {
    mockListMicroservices.mockResolvedValue(['large']);
    const entities = Array.from({ length: 300 }, (_, i) => ({
      name: i === 275 ? 'SpecialInvoice' : `Entity${i}`,
      description: i === 275 ? 'quarterly billing target' : '',
      attributes: [],
    }));
    const services = { serviceService: { getServiceEntities: jest.fn(async () => entities) } };

    const bounded: any = await executeListEntities({ packageName: 'large' }, services);
    expect(bounded.total).toBe(300);
    expect(bounded.count).toBe(50);
    expect(bounded.truncated).toBe(true);
    expect(bounded.note).toContain('searchModel');

    const filtered: any = await executeListEntities({ packageName: 'large', query: 'quarterly' }, services);
    expect(filtered.entities.map((e: any) => e.name)).toEqual(['SpecialInvoice']);
    expect(filtered.truncated).toBe(false);
  });

  it('no packageName → the package list', async () => {
    const r: any = await executeListEntities({}, makeServices());
    expect(r.packages).toEqual(['order-service', 'customer-service', 'billing-service']);
  });
});
