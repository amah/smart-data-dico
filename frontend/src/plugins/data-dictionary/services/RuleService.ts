import axios, { type AxiosInstance } from 'axios';
import type {
  Rule,
  RuleScope,
  RuleSeverityValue,
  RuleEnforcement,
} from '../../../types';

/**
 * Filters for the `list()` method. All fields are optional.
 */
export interface RuleListFilters {
  scope?: RuleScope;
  severity?: RuleSeverityValue;
  enforcement?: RuleEnforcement;
  targetUuid?: string;
  case?: string;
  package?: string;
}

/**
 * Pattern B service — thin axios wrapper over `/api/rules/**` and
 * `/api/entities/:uuid/rules`.
 *
 * Mirrors IntegrityService shape (cookbook §3b). Constructor accepts an
 * optional AxiosInstance so unit tests can inject a stub; production code
 * calls `new RuleService()` and receives the default instance built by
 * `createDefaultHttp()`.
 *
 * Does NOT import from `@/services/api` (cookbook anti-pattern: Pattern B
 * services are self-contained).
 */
export class RuleService {
  private readonly http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    this.http = http ?? RuleService.createDefaultHttp();
  }

  /** List rules with optional filters. */
  async list(filters: RuleListFilters = {}): Promise<Rule[]> {
    const params = new URLSearchParams();
    if (filters.scope) params.set('scope', filters.scope);
    if (filters.severity) params.set('severity', filters.severity);
    if (filters.enforcement) params.set('enforcement', filters.enforcement);
    if (filters.targetUuid) params.set('targetUuid', filters.targetUuid);
    if (filters.case) params.set('case', filters.case);
    if (filters.package) params.set('package', filters.package);
    const qs = params.toString();
    const response = await this.http.get<{ data: Rule[] }>(`/rules${qs ? '?' + qs : ''}`);
    return response.data.data;
  }

  /** Get a single rule by uuid. */
  async get(uuid: string): Promise<Rule> {
    const response = await this.http.get<{ data: Rule }>(`/rules/${uuid}`);
    return response.data.data;
  }

  /** Get all rules for a specific entity. */
  async getRulesForEntity(entityUuid: string): Promise<Rule[]> {
    const response = await this.http.get<{ data: Rule[] }>(`/entities/${entityUuid}/rules`);
    return response.data.data;
  }

  /** Create a new rule. */
  async create(rule: Partial<Rule>): Promise<Rule> {
    const response = await this.http.post<{ data: Rule }>('/rules', rule);
    return response.data.data;
  }

  /** Update an existing rule. */
  async update(uuid: string, rule: Partial<Rule>): Promise<Rule> {
    const response = await this.http.put<{ data: Rule }>(`/rules/${uuid}`, rule);
    return response.data.data;
  }

  /** Delete a rule by uuid. */
  async delete(uuid: string): Promise<void> {
    await this.http.delete(`/rules/${uuid}`);
  }

  private static createDefaultHttp(): AxiosInstance {
    const instance = axios.create({
      baseURL: '/api',
      headers: { 'Content-Type': 'application/json' },
    });
    instance.interceptors.request.use((config) => {
      const token = localStorage.getItem('auth_token') || 'mock-token-for-testing';
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    return instance;
  }
}
