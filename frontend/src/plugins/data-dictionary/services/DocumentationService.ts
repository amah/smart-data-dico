import axios, { type AxiosInstance } from 'axios';
import type { Documentation, DocumentationChunk, DocumentationScope, DocumentationStatus } from '../../../types';

export interface DocumentationFilters {
  scope?: DocumentationScope;
  package?: string;
  status?: DocumentationStatus;
  audience?: string;
  language?: string;
  tag?: string;
  concept?: string;
  relatedRef?: string;
}

export type DocumentationInput = Omit<Documentation, 'sourcePath'> & { filename?: string };

export class DocumentationService {
  private readonly http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    this.http = http ?? DocumentationService.createDefaultHttp();
  }

  async list(filters: DocumentationFilters = {}): Promise<Documentation[]> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    const query = params.toString();
    const response = await this.http.get<{ data: Documentation[] }>(`/documentation${query ? `?${query}` : ''}`);
    return response.data.data;
  }

  async get(uuid: string): Promise<Documentation> {
    const response = await this.http.get<{ data: Documentation }>(`/documentation/${uuid}`);
    return response.data.data;
  }

  async chunks(uuid: string): Promise<DocumentationChunk[]> {
    const response = await this.http.get<{ data: DocumentationChunk[] }>(`/documentation/${uuid}/chunks`);
    return response.data.data;
  }

  async create(document: DocumentationInput): Promise<Documentation> {
    const response = await this.http.post<{ data: Documentation }>('/documentation', document);
    return response.data.data;
  }

  async update(uuid: string, document: Partial<DocumentationInput>): Promise<Documentation> {
    const response = await this.http.put<{ data: Documentation }>(`/documentation/${uuid}`, document);
    return response.data.data;
  }

  async delete(uuid: string): Promise<void> {
    await this.http.delete(`/documentation/${uuid}`);
  }

  private static createDefaultHttp(): AxiosInstance {
    const instance = axios.create({ baseURL: '/api', headers: { 'Content-Type': 'application/json' } });
    instance.interceptors.request.use(config => {
      config.headers.Authorization = `Bearer ${localStorage.getItem('auth_token') || 'mock-token-for-testing'}`;
      return config;
    });
    return instance;
  }
}
