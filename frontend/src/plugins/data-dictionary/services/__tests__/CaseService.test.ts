/**
 * #161 cases-rules — CaseService unit suite.
 *
 * Covers spec acceptance criteria #20 and #22:
 *   - Service is constructed with a stub `AxiosInstance` (constructor
 *     injection — NOT vi.mock('axios')).
 *   - getAll() calls `stubHttp.get` with the literal '/cases'.
 *   - resolve(id) calls `stubHttp.get` with `/cases/${id}/resolve`.
 *   - Envelope unwrap returns inner shape (one `.data` layer from axios +
 *     one `.data` from the backend envelope).
 *   - Rejection bubbles (no internal try/catch).
 *   - Default construction (no http arg) does not throw.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { CaseService } from '../CaseService';
import type { Case, ResolvedCase } from '../../../../types';

const sampleCase: Case = {
  uuid: 'c-1',
  name: 'Ordering',
  rootEntities: ['e-order'],
};

const sampleResolved: ResolvedCase = {
  uuid: 'c-1',
  name: 'Ordering',
  rootEntities: ['e-order'],
  resolvedNodes: [],
};

function makeStubHttp(impl: Partial<Record<'get' | 'post' | 'put' | 'delete', ReturnType<typeof vi.fn>>>): AxiosInstance {
  return impl as unknown as AxiosInstance;
}

describe('CaseService — unit (constructor-injected http)', () => {
  it('getAll() calls http.get with the literal "/cases" path', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { data: [sampleCase] } });
    const service = new CaseService(makeStubHttp({ get: getMock }));

    await service.getAll();

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith('/cases');
  });

  it('getAll() unwraps the { data: [...] } envelope and returns the inner array', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { data: [sampleCase] } });
    const service = new CaseService(makeStubHttp({ get: getMock }));

    const result = await service.getAll();

    expect(result).toEqual([sampleCase]);
    expect(result[0].uuid).toBe('c-1');
  });

  it('resolve(id) calls http.get with `/cases/${id}/resolve`', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { data: sampleResolved } });
    const service = new CaseService(makeStubHttp({ get: getMock }));

    await service.resolve('c-1');

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith('/cases/c-1/resolve');
  });

  it('resolve(id) unwraps the { data: ResolvedCase } envelope', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { data: sampleResolved } });
    const service = new CaseService(makeStubHttp({ get: getMock }));

    const result = await service.resolve('c-1');

    expect(result).toEqual(sampleResolved);
    expect(result.resolvedNodes).toEqual([]);
  });

  it('getAll() rejects when http.get rejects (no internal swallow)', async () => {
    const getMock = vi.fn().mockRejectedValue(new Error('network error'));
    const service = new CaseService(makeStubHttp({ get: getMock }));

    await expect(service.getAll()).rejects.toThrow('network error');
  });

  it('default construction (no http arg) does not throw and produces a usable instance', () => {
    const service = new CaseService();
    expect(service).toBeInstanceOf(CaseService);
    expect(typeof service.getAll).toBe('function');
    expect(typeof service.getById).toBe('function');
    expect(typeof service.create).toBe('function');
    expect(typeof service.update).toBe('function');
    expect(typeof service.delete).toBe('function');
    expect(typeof service.resolve).toBe('function');
    expect(typeof service.getGraphData).toBe('function');
    expect(typeof service.upsertNode).toBe('function');
  });
});
