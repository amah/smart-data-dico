/**
 * #161 cases-rules — RuleService unit suite.
 *
 * Covers spec acceptance criteria #21 and #22:
 *   - Service is constructed with a stub `AxiosInstance` (constructor
 *     injection — NOT vi.mock('axios')).
 *   - list({scope:'entity'}) calls `stubHttp.get` with `/rules?scope=entity`.
 *   - getRulesForEntity(uuid) calls `stubHttp.get` with `/entities/${uuid}/rules`.
 *   - Envelope unwrap returns inner shape.
 *   - Rejection bubbles (no internal try/catch).
 *   - Default construction (no http arg) does not throw.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { RuleService } from '../RuleService';
import type { Rule } from '../../../../types';

const sampleRule: Rule = {
  uuid: 'r-1',
  name: 'order-total-positive',
  description: 'Order total must be positive.',
  severity: 'error',
  enforcement: 'save',
  scope: 'package',
  packageName: 'order-service',
  targets: [],
};

function makeStubHttp(impl: Partial<Record<'get' | 'post' | 'put' | 'delete', ReturnType<typeof vi.fn>>>): AxiosInstance {
  return impl as unknown as AxiosInstance;
}

describe('RuleService — unit (constructor-injected http)', () => {
  it('list({ scope: "entity" }) calls http.get with `/rules?scope=entity`', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { data: [sampleRule] } });
    const service = new RuleService(makeStubHttp({ get: getMock }));

    await service.list({ scope: 'entity' });

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith('/rules?scope=entity');
  });

  it('list() with no filters calls http.get with `/rules` (no query string)', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { data: [] } });
    const service = new RuleService(makeStubHttp({ get: getMock }));

    await service.list();

    expect(getMock).toHaveBeenCalledWith('/rules');
  });

  it('list() unwraps the { data: [...] } envelope and returns the inner array', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { data: [sampleRule] } });
    const service = new RuleService(makeStubHttp({ get: getMock }));

    const result = await service.list({ scope: 'entity' });

    expect(result).toEqual([sampleRule]);
    expect(result[0].uuid).toBe('r-1');
  });

  it('getRulesForEntity(uuid) calls http.get with `/entities/${uuid}/rules`', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { data: [sampleRule] } });
    const service = new RuleService(makeStubHttp({ get: getMock }));

    await service.getRulesForEntity('e-123');

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith('/entities/e-123/rules');
  });

  it('getRulesForEntity(uuid) unwraps envelope and returns inner array', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { data: [sampleRule] } });
    const service = new RuleService(makeStubHttp({ get: getMock }));

    const result = await service.getRulesForEntity('e-123');

    expect(result).toEqual([sampleRule]);
  });

  it('list() rejects when http.get rejects (no internal swallow)', async () => {
    const getMock = vi.fn().mockRejectedValue(new Error('network error'));
    const service = new RuleService(makeStubHttp({ get: getMock }));

    await expect(service.list()).rejects.toThrow('network error');
  });

  it('default construction (no http arg) does not throw and produces a usable instance', () => {
    const service = new RuleService();
    expect(service).toBeInstanceOf(RuleService);
    expect(typeof service.list).toBe('function');
    expect(typeof service.get).toBe('function');
    expect(typeof service.getRulesForEntity).toBe('function');
    expect(typeof service.create).toBe('function');
    expect(typeof service.update).toBe('function');
    expect(typeof service.delete).toBe('function');
  });
});
