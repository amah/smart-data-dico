import type { WorkspaceId, Path } from './types.js';
import type { Entity } from '../../models/EntitySchema.js';

export interface SearchQuery { text: string; limit?: number; }
export interface TraverseOpts { depth?: number; direction?: 'in' | 'out' | 'both'; }
export interface ImpactResult { uuids: string[]; }
export interface LineageResult { uuids: string[]; }
export type ResolvedCase = Record<string, unknown>; // see #155 case service; slice 1 leaves loose

export interface IDictionaryQuery {
  searchEntities(ws: WorkspaceId, query: SearchQuery): Promise<Entity[]>;
  traverse(ws: WorkspaceId, fromUuid: string, opts: TraverseOpts): Promise<Path[]>;
  impact(ws: WorkspaceId, uuid: string, direction: 'upstream' | 'downstream'): Promise<ImpactResult>;
  lineage(ws: WorkspaceId, uuid: string, direction: 'upstream' | 'downstream'): Promise<LineageResult>;
  resolveCase(ws: WorkspaceId, caseId: string): Promise<ResolvedCase>;
}
