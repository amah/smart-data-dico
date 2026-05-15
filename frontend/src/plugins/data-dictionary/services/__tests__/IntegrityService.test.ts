/**
 * #155 integrity-slice — IntegrityService unit suite.
 *
 * Covers spec acceptance criterion #8:
 *   - Service is constructed with a stub `AxiosInstance` (constructor
 *     injection — NOT vi.mock('axios')).
 *   - getReport() calls `stubHttp.get` with the literal '/integrity'.
 *   - getReport() unwraps the `{ data: { ... } }` envelope and returns
 *     the inner IntegrityReport (one layer of `.data` unwrap).
 *   - When the stub get rejects, the promise rejects (no internal
 *     try/catch — page is responsible for surfacing the error).
 *
 * No MSW here. MSW is reserved for the bootstrap test (criterion #9/#10).
 * The service's optional-AxiosInstance ctor parameter exists precisely
 * for this style of isolated unit test.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AxiosInstance } from 'axios';

import {
  IntegrityService,
  type IntegrityReport,
} from '../IntegrityService';

const sampleReport: IntegrityReport = {
  validation: [
    {
      service: 'user-service',
      entityUuid: 'e-user',
      entityName: 'User',
      attributeUuid: 'a-username',
      attributeName: 'username',
      kind: 'maxLength',
      value: 50,
    },
  ],
  constraints: [
    {
      service: 'user-service',
      entityUuid: 'e-user',
      entityName: 'User',
      constraint: { kind: 'unique', name: 'uq_users_email', columns: ['email'] },
    },
  ],
  rules: [
    {
      uuid: 'r-1',
      name: 'order-total-positive',
      description: 'Order total must be positive.',
      severity: 'error',
      enforcement: 'save',
      scope: 'package',
      packageName: 'order-service',
      targets: [],
    },
  ],
};

/**
 * Build a stub AxiosInstance containing only the methods IntegrityService
 * actually uses. Cast through `unknown` to satisfy the AxiosInstance
 * structural type — we intentionally do NOT implement the full surface.
 */
function makeStubHttp(getImpl: ReturnType<typeof vi.fn>): AxiosInstance {
  return { get: getImpl } as unknown as AxiosInstance;
}

describe('IntegrityService — unit (constructor-injected http)', () => {
  it('getReport() calls http.get with the literal "/integrity" path', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { data: sampleReport } });
    const service = new IntegrityService(makeStubHttp(getMock));

    await service.getReport();

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith('/integrity');
  });

  it('getReport() unwraps the { data: { ... } } envelope and returns the inner report', async () => {
    const getMock = vi
      .fn()
      .mockResolvedValue({ data: { data: sampleReport } });
    const service = new IntegrityService(makeStubHttp(getMock));

    const result = await service.getReport();

    // One layer of `.data` unwrap (axios response.data) plus the backend's
    // `{ data: IntegrityReport }` envelope = report itself, not wrapped.
    expect(result).toEqual(sampleReport);
    expect(result.validation).toHaveLength(1);
    expect(result.constraints).toHaveLength(1);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].severity).toBe('error');
  });

  it('getReport() rejects when http.get rejects (no internal swallow)', async () => {
    const getMock = vi.fn().mockRejectedValue(new Error('boom'));
    const service = new IntegrityService(makeStubHttp(getMock));

    await expect(service.getReport()).rejects.toThrow('boom');
  });

  it('default construction (no http arg) does not throw and produces a usable instance', () => {
    // Production callsite: `new IntegrityService()` builds the default
    // axios instance via createDefaultHttp(). We only assert the
    // constructor does not throw and the public surface is present —
    // an actual HTTP call would require MSW (see bootstrap test).
    const service = new IntegrityService();
    expect(service).toBeInstanceOf(IntegrityService);
    expect(typeof service.getReport).toBe('function');
  });
});
