import YAML from 'yaml';
import { storageRegistry } from '../../storage/contract/StorageBackendToken.js';
import type { IStorageBackend } from '../../storage/contract/IStorageBackend.js';
import { pathOf, wsId, type Path, type WorkspaceId } from '../../storage/contract/types.js';
import type { Documentation } from '../../models/Documentation.js';
import { parseDocumentation } from './documentationParser.js';
import { findDuplicateDocumentationUuids } from './documentationValidation.js';

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const isNotFound = (error: unknown): boolean => {
  const code = (error as { code?: string }).code;
  return code === 'not-found' || code === 'ENOENT';
};

export type DocumentationInput = Omit<Documentation, 'sourcePath' | 'contentStartLine' | 'uuid'> & {
  uuid?: string;
  filename?: string;
  sourcePath?: never;
};

export interface DocumentationLocation {
  sourcePath: string;
  scope: 'project' | 'package';
  packageName?: string;
}

export class DocumentationRepository {
  private _storage?: IStorageBackend;
  private get storage(): IStorageBackend {
    if (!this._storage) this._storage = storageRegistry.getBackend();
    return this._storage;
  }

  constructor(
    storage?: IStorageBackend,
    private readonly ws: WorkspaceId = wsId('dictionaries'),
  ) {
    this._storage = storage;
  }

  async list(): Promise<Documentation[]> {
    const locations: DocumentationLocation[] = [];
    await this.collectMarkdown('documentation', 'project', undefined, locations);
    for (const packageName of await this.listPackageNames()) {
      await this.collectMarkdown(`${packageName}/documentation`, 'package', packageName, locations);
    }

    const documents: Documentation[] = [];
    for (const location of locations) {
      try {
        const markdown = await this.storage.read(this.ws, pathOf(location.sourcePath));
        const parsed = parseDocumentation(markdown, location);
        if (parsed.document && !parsed.issues.some(issue => issue.severity === 'error')) documents.push(parsed.document);
      } catch (error) {
        // A malformed document is a validation concern, but a disappearing file
        // during discovery is safe to ignore.
        if (!isNotFound(error)) throw error;
      }
    }
    const duplicateIssues = findDuplicateDocumentationUuids(documents);
    if (duplicateIssues.length) throw new Error(duplicateIssues.map(issue => issue.message).join('; '));
    return documents.sort((a, b) => a.title.localeCompare(b.title));
  }

  async get(uuid: string): Promise<Documentation | null> {
    return (await this.list()).find(document => document.uuid === uuid) ?? null;
  }

  async write(input: DocumentationInput, existing?: Documentation): Promise<Documentation> {
    this.assertSafeInput(input);
    const scope = input.scope ?? existing?.scope ?? 'project';
    const packageName = scope === 'package' ? input.packageName ?? existing?.packageName : undefined;
    if (scope === 'package' && (!packageName || !SAFE_SEGMENT.test(packageName))) {
      throw new Error('A valid packageName is required for package documentation');
    }
    const uuid = input.uuid ?? existing?.uuid;
    if (!uuid) throw new Error('Documentation uuid is required');
    const sameLocation = existing?.scope === scope && existing?.packageName === packageName;
    const filename = this.safeFilename(input.filename ?? existing?.sourcePath.split('/').pop() ?? `${uuid}.md`);
    const base = scope === 'package' ? `${packageName}/documentation` : 'documentation';
    const sourcePath = sameLocation && !input.filename ? existing.sourcePath : `${base}/${filename}`;
    // sourcePath is derived from scope/package/filename and must never be
    // serialized back into authored front matter.
    const existingAuthored = existing
      ? (({ sourcePath: _sourcePath, ...rest }) => rest)(existing)
      : {};
    const markdown = this.serialize({ ...existingAuthored, ...input, uuid, scope, packageName });
    await this.storage.write(this.ws, pathOf(sourcePath), markdown, { createParents: true });
    if (existing && existing.sourcePath !== sourcePath) await this.deletePath(pathOf(existing.sourcePath));
    const parsed = parseDocumentation(markdown, { sourcePath, scope, packageName });
    const errors = parsed.issues.filter(issue => issue.severity === 'error');
    if (!parsed.document || errors.length) throw new Error(errors.map(issue => issue.message).join('; ') || 'Invalid documentation');
    return parsed.document;
  }

  async delete(document: Documentation): Promise<void> {
    await this.storage.delete(this.ws, pathOf(document.sourcePath));
  }

  private async listPackageNames(): Promise<string[]> {
    let entries;
    try { entries = await this.storage.list(this.ws, pathOf('')); }
    catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const packages: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory || !SAFE_SEGMENT.test(entry.name)) continue;
      try {
        const marker = await this.storage.stat(this.ws, pathOf(`${entry.name}/package.yaml`));
        if (!marker.isDirectory) packages.push(entry.name);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    return packages;
  }

  private async collectMarkdown(dir: string, scope: 'project' | 'package', packageName: string | undefined, output: DocumentationLocation[]): Promise<void> {
    let entries;
    try { entries = await this.storage.list(this.ws, pathOf(dir)); }
    catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    for (const entry of entries) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory) await this.collectMarkdown(child, scope, packageName, output);
      else if (entry.name.toLowerCase().endsWith('.md')) output.push({ sourcePath: child, scope, packageName });
    }
  }

  private serialize(input: DocumentationInput & { uuid: string; scope: 'project' | 'package' }): string {
    const { content = '', filename: _filename, sourcePath: _sourcePath, contentStartLine: _contentStartLine, extensions, ...known } = input as DocumentationInput & { sourcePath?: string; contentStartLine?: number };
    const frontMatter = { ...extensions, ...known };
    return `---\n${YAML.stringify(frontMatter).trimEnd()}\n---\n\n${content.trimEnd()}\n`;
  }

  private safeFilename(value: string): string {
    const filename = value.endsWith('.md') ? value : `${value}.md`;
    if (!SAFE_SEGMENT.test(filename) || filename === '.md') throw new Error('Invalid documentation filename');
    return filename;
  }

  private assertSafeInput(input: DocumentationInput): void {
    if (input.sourcePath !== undefined) throw new Error('sourcePath is derived and cannot be supplied');
    if (input.filename?.includes('/') || input.filename?.includes('\\')) throw new Error('Invalid documentation filename');
  }

  private async deletePath(path: Path): Promise<void> {
    try { await this.storage.delete(this.ws, path); }
    catch (error) { if (!isNotFound(error)) throw error; }
  }
}
