/**
 * Tests for the model snapshot loader's whole-model paths.
 *
 * Verifies:
 *   - The new `'all-services'` SnapshotSource variant loads every service
 *     from the working copy into one ModelSnapshot.
 *   - Each PackageSnapshot carries its service name, so multi-service
 *     diffs can group by service downstream.
 *   - A failure loading one service doesn't abort the whole snapshot.
 */
jest.mock('../../utils/logger');
jest.mock('../../utils/fileOperations', () => ({
  listMicroservices: jest.fn(),
  getPackagePath: (n: string) => `/tmp/${n}`,
}));
jest.mock('../serviceService', () => ({
  serviceService: {
    getServiceEntities: jest.fn(),
    getPackageRelationships: jest.fn(),
  },
}));
jest.mock('../ruleService', () => ({
  ruleService: { listRules: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadModelSnapshot } = require('../modelSnapshotLoader');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listMicroservices } = require('../../utils/fileOperations');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { serviceService } = require('../serviceService');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ruleService } = require('../ruleService');

const entity = (uuid: string, name: string) => ({
  uuid,
  name,
  description: '',
  status: 'draft',
  attributes: [],
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("loadModelSnapshot — { type: 'all-services' }", () => {
  it('loads every service and populates the `service` field on each package', async () => {
    listMicroservices.mockResolvedValue(['order-service', 'user-service']);
    serviceService.getServiceEntities.mockImplementation(async (name: string) =>
      name === 'order-service' ? [entity('o1', 'Order')] : [entity('u1', 'User')],
    );
    serviceService.getPackageRelationships.mockResolvedValue([]);
    ruleService.listRules.mockResolvedValue([]);

    const snap = await loadModelSnapshot({ type: 'all-services' });

    expect(snap.packages).toHaveLength(2);
    expect(snap.packages.map((p: any) => p.service).sort()).toEqual([
      'order-service',
      'user-service',
    ]);
    expect(snap.packages.map((p: any) => p.packageName).sort()).toEqual([
      'order-service',
      'user-service',
    ]);
    const order = snap.packages.find((p: any) => p.service === 'order-service');
    expect(order.entities[0].name).toBe('Order');
  });

  it('continues loading remaining services when one fails', async () => {
    listMicroservices.mockResolvedValue(['broken', 'ok-service']);
    serviceService.getServiceEntities.mockImplementation(async (name: string) => {
      if (name === 'broken') throw new Error('disk ate my entities');
      return [entity('e1', 'E')];
    });
    serviceService.getPackageRelationships.mockResolvedValue([]);
    ruleService.listRules.mockResolvedValue([]);

    const snap = await loadModelSnapshot({ type: 'all-services' });
    expect(snap.packages).toHaveLength(1);
    expect(snap.packages[0].service).toBe('ok-service');
  });

  it("also populates `service` for { type: 'service' } (single-service path)", async () => {
    listMicroservices.mockResolvedValue(['order-service']);
    serviceService.getServiceEntities.mockResolvedValue([entity('o1', 'Order')]);
    serviceService.getPackageRelationships.mockResolvedValue([]);
    ruleService.listRules.mockResolvedValue([]);

    const snap = await loadModelSnapshot({ type: 'service', name: 'order-service' });
    expect(snap.packages).toHaveLength(1);
    expect(snap.packages[0].service).toBe('order-service');
    expect(snap.packages[0].packageName).toBe('order-service');
  });
});
