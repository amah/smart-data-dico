import { isValidUUID } from '../../utils/uuid.js';
import type { Documentation } from '../../models/Documentation.js';
export interface DocumentationValidationIssue { severity: 'error' | 'warning'; field: string; message: string }
export function validateDocumentation(document: Documentation): DocumentationValidationIssue[] {
  const issues: DocumentationValidationIssue[] = [];
  const statuses = new Set(['draft', 'review', 'approved', 'deprecated']);
  if (!document.uuid || !isValidUUID(document.uuid)) issues.push({ severity: 'error', field: 'uuid', message: 'uuid must be a valid UUID' });
  if (!document.title.trim()) issues.push({ severity: 'error', field: 'title', message: 'title is required' });
  if (!document.summary?.trim()) issues.push({ severity: 'warning', field: 'summary', message: 'summary is recommended for retrieval results' });
  if (document.status && !statuses.has(document.status)) issues.push({ severity: 'error', field: 'status', message: 'status must be draft, review, approved, or deprecated' });
  if (document.status === 'approved' && !document.owners?.length) issues.push({ severity: 'warning', field: 'owners', message: 'approved documentation should have an owner' });
  if (document.scope === 'package' && !document.packageName) issues.push({ severity: 'error', field: 'packageName', message: 'packageName is required for package documentation' });
  if (document.scope === 'project' && document.packageName) issues.push({ severity: 'warning', field: 'packageName', message: 'packageName is ignored for project documentation' });
  if (document.effectiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(document.effectiveFrom)) issues.push({ severity: 'error', field: 'effectiveFrom', message: 'effectiveFrom must use YYYY-MM-DD' });
  if (document.effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(document.effectiveTo)) issues.push({ severity: 'error', field: 'effectiveTo', message: 'effectiveTo must use YYYY-MM-DD' });
  if (document.effectiveFrom && document.effectiveTo && document.effectiveFrom > document.effectiveTo) issues.push({ severity: 'error', field: 'effectiveTo', message: 'effectiveTo must not precede effectiveFrom' });
  if (!document.content.trim()) issues.push({ severity: 'warning', field: 'content', message: 'documentation has no body content' });
  return issues;
}
export function findDuplicateDocumentationUuids(documents: Documentation[]): DocumentationValidationIssue[] {
  const seen = new Set<string>(); const duplicates = new Set<string>();
  for (const document of documents) { if (seen.has(document.uuid)) duplicates.add(document.uuid); seen.add(document.uuid); }
  return [...duplicates].map(uuid => ({ severity: 'error' as const, field: 'uuid', message: `duplicate documentation uuid: ${uuid}` }));
}
