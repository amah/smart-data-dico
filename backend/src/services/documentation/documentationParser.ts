import { parse as parseYaml } from 'yaml';
import type { Documentation, DocumentationScope } from '../../models/Documentation.js';
import { validateDocumentation, type DocumentationValidationIssue } from './documentationValidation.js';
const KNOWN_FIELDS = new Set(['uuid', 'title', 'summary', 'scope', 'packageName', 'status', 'audience', 'tags', 'concepts', 'related', 'owners', 'language', 'effectiveFrom', 'effectiveTo', 'metadata']);
export interface ParseDocumentationOptions { sourcePath: string; scope: DocumentationScope; packageName?: string }
export interface ParsedDocumentation { document?: Documentation; issues: DocumentationValidationIssue[] }
export function parseDocumentation(markdown: string, options: ParseDocumentationOptions): ParsedDocumentation {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) return { issues: [{ severity: 'error', field: 'frontMatter', message: 'YAML front matter is required' }] };
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) return { issues: [{ severity: 'error', field: 'frontMatter', message: 'YAML front matter is not closed' }] };
  let raw: unknown;
  try { raw = parseYaml(normalized.slice(4, end)); }
  catch (error) { return { issues: [{ severity: 'error', field: 'frontMatter', message: `invalid YAML: ${error instanceof Error ? error.message : String(error)}` }] }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { issues: [{ severity: 'error', field: 'frontMatter', message: 'front matter must be a mapping' }] };
  const values = raw as Record<string, unknown>; const issues: DocumentationValidationIssue[] = [];
  if (values.scope !== undefined && values.scope !== options.scope) issues.push({ severity: 'error', field: 'scope', message: `declared scope does not match ${options.scope} file location` });
  if (values.packageName !== undefined && values.packageName !== options.packageName) issues.push({ severity: 'error', field: 'packageName', message: 'declared packageName does not match file location' });
  const extensions = Object.fromEntries(Object.entries(values).filter(([key]) => !KNOWN_FIELDS.has(key)));
  const document: Documentation = {
    ...(values as unknown as Documentation), uuid: typeof values.uuid === 'string' ? values.uuid : '',
    title: typeof values.title === 'string' ? values.title : '', scope: options.scope,
    packageName: options.scope === 'package' ? options.packageName : undefined,
    content: normalized.slice(end + 5), sourcePath: options.sourcePath,
    contentStartLine: normalized.slice(0, end + 5).split('\n').length,
    extensions: Object.keys(extensions).length ? extensions : undefined,
  };
  issues.push(...validateDocumentation(document));
  return { document, issues };
}
