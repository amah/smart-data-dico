/**
 * #155-search — SearchService unit suite.
 *
 * Covers spec acceptance criteria #3 – #9:
 *   - Constructor accepts an optional AxiosInstance (no-arg construction OK).
 *   - searchEntities() builds the correct URL for the no-filter case.
 *   - searchEntities() appends a single filter correctly.
 *   - searchEntities() appends all four filters in the prescribed order.
 *   - searchEntities() with a partial filter set only appends the set fields.
 *   - When http.get rejects, the promise rejects (no internal swallow).
 *   - The returned value is the full envelope { message, data: SearchResult[] }.
 *
 * No MSW here — constructor injection is used throughout. vi.mock('axios') is
 * intentionally NOT used (spec anti-pattern note). The stub AxiosInstance is
 * built via `makeStubHttp` exactly as in the IntegrityService.test.ts precedent.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AxiosInstance } from 'axios';

import {
  SearchService,
  type SearchResponse,
} from '../SearchService';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

const sampleResult = {
  type: 'entity' as const,
  entityName: 'Order',
  service: 'order-service',
  name: 'Order',
  description: 'Order aggregate',
  path: 'order-service/Order.model.yaml',
};

const sampleEnvelope: SearchResponse = {
  message: 'OK',
  data: [sampleResult],
};

/**
 * Build a stub AxiosInstance containing only the `get` method that
 * SearchService calls. Cast through `unknown` to satisfy AxiosInstance's
 * structural type without implementing the full surface.
 */
function makeStubHttp(getImpl: ReturnType<typeof vi.fn>): AxiosInstance {
  return { get: getImpl } as unknown as AxiosInstance;
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('SearchService — constructor (criterion #3)', () => {
  it('default construction (no http arg) does not throw and produces a usable instance', () => {
    const service = new SearchService();
    expect(service).toBeInstanceOf(SearchService);
    expect(typeof service.searchEntities).toBe('function');
  });
});

describe('SearchService — no-filter call (criterion #4)', () => {
  it('searchEntities(query) calls http.get exactly once with /search?q=<query>', async () => {
    const getMock = vi
      .fn()
      .mockResolvedValue({ data: sampleEnvelope });
    const service = new SearchService(makeStubHttp(getMock));

    await service.searchEntities('alpha');

    expect(getMock).toHaveBeenCalledTimes(1);
    // URL must contain q=alpha and only q (no extra params)
    const calledUrl: string = getMock.mock.calls[0][0];
    expect(calledUrl).toBe('/search?q=alpha');
  });
});

describe('SearchService — single filter (criterion #5)', () => {
  it('searchEntities(query, { type }) appends type param', async () => {
    const getMock = vi
      .fn()
      .mockResolvedValue({ data: sampleEnvelope });
    const service = new SearchService(makeStubHttp(getMock));

    await service.searchEntities('alpha', { type: 'entity' });

    const calledUrl: string = getMock.mock.calls[0][0];
    expect(calledUrl).toBe('/search?q=alpha&type=entity');
  });
});

describe('SearchService — all four filters (criterion #6)', () => {
  it(
    'searchEntities with all four filters appends them in the prescribed order: q, type, service, stereotype, hasMetadata',
    async () => {
      const getMock = vi
        .fn()
        .mockResolvedValue({ data: sampleEnvelope });
      const service = new SearchService(makeStubHttp(getMock));

      await service.searchEntities('alpha', {
        type: 'entity',
        service: 'user-service',
        stereotype: 'Aggregate',
        hasMetadata: 'pii=true',
      });

      const calledUrl: string = getMock.mock.calls[0][0];
      // Exact ordering preserved from legacy servicesApi.searchEntities
      expect(calledUrl).toBe(
        '/search?q=alpha&type=entity&service=user-service&stereotype=Aggregate&hasMetadata=pii%3Dtrue',
      );
    },
  );
});

describe('SearchService — partial filter (criterion #7)', () => {
  it('searchEntities with only the service filter omits type, stereotype, and hasMetadata', async () => {
    const getMock = vi
      .fn()
      .mockResolvedValue({ data: sampleEnvelope });
    const service = new SearchService(makeStubHttp(getMock));

    await service.searchEntities('alpha', { service: 'orders' });

    const calledUrl: string = getMock.mock.calls[0][0];
    expect(calledUrl).toContain('service=orders');
    expect(calledUrl).not.toContain('type=');
    expect(calledUrl).not.toContain('stereotype=');
    expect(calledUrl).not.toContain('hasMetadata=');
  });
});

describe('SearchService — rejection (criterion #8)', () => {
  it('rejects with the same error when http.get rejects (no internal swallow)', async () => {
    const getMock = vi.fn().mockRejectedValue(new Error('boom'));
    const service = new SearchService(makeStubHttp(getMock));

    await expect(service.searchEntities('x')).rejects.toThrow('boom');
  });
});

describe('SearchService — envelope return shape (criterion #9)', () => {
  it('resolves to the full { message, data } envelope, NOT just the inner array', async () => {
    const getMock = vi
      .fn()
      .mockResolvedValue({ data: sampleEnvelope });
    const service = new SearchService(makeStubHttp(getMock));

    const result = await service.searchEntities('alpha');

    // Must expose `message` string AND `data` array — the full envelope
    expect(typeof result.message).toBe('string');
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].entityName).toBe('Order');
  });
});
