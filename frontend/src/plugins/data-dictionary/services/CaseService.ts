import axios, { type AxiosInstance } from 'axios';
import type { Case, ResolvedCase, CaseNode, GraphData } from '../../../types';

/**
 * Pattern B service — thin axios wrapper over `/api/cases/**`.
 *
 * Mirrors IntegrityService shape (cookbook §3b). Constructor accepts an
 * optional AxiosInstance so unit tests can inject a stub; production code
 * calls `new CaseService()` and receives the default instance built by
 * `createDefaultHttp()`.
 *
 * Does NOT import from `@/services/api` (cookbook anti-pattern: Pattern B
 * services are self-contained). Auth header replication matches
 * `services/api.ts:23-32` for parity with the legacy shim.
 */
export class CaseService {
  private readonly http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    this.http = http ?? CaseService.createDefaultHttp();
  }

  /** List all cases. */
  async getAll(): Promise<Case[]> {
    const response = await this.http.get<{ data: Case[] }>('/cases');
    return response.data.data;
  }

  /** Get a single case by id. */
  async getById(id: string): Promise<Case> {
    const response = await this.http.get<{ data: Case }>(`/cases/${id}`);
    return response.data.data;
  }

  /** Create a new case. Returns the envelope `{ data: Case }`. */
  async create(data: Partial<Case>): Promise<{ data: Case }> {
    const response = await this.http.post<{ data: Case }>('/cases', data);
    return response.data;
  }

  /** Update an existing case. Returns the envelope `{ data: Case }`. */
  async update(id: string, data: Partial<Case>): Promise<{ data: Case }> {
    const response = await this.http.put<{ data: Case }>(`/cases/${id}`, data);
    return response.data;
  }

  /** Delete a case by id. */
  async delete(id: string): Promise<void> {
    await this.http.delete(`/cases/${id}`);
  }

  /** Resolve a case (BFS traversal). */
  async resolve(id: string): Promise<ResolvedCase> {
    const response = await this.http.get<{ data: ResolvedCase }>(`/cases/${id}/resolve`);
    return response.data.data;
  }

  /** Get graph data for a case. */
  async getGraphData(id: string): Promise<GraphData> {
    const response = await this.http.get<{ data: GraphData }>(`/cases/${id}/graph`);
    return response.data.data;
  }

  /** Upsert a node annotation on a case. Returns the envelope `{ data: Case }`. */
  async upsertNode(id: string, node: CaseNode): Promise<{ data: Case }> {
    const response = await this.http.put<{ data: Case }>(`/cases/${id}/nodes`, node);
    return response.data;
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
