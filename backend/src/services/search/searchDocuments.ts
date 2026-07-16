/**
 * Search-document model (#search-index).
 *
 * A pure, storage-agnostic flattening of a loaded `Package` into the flat
 * `SearchDoc[]` that the FTS5 index stores and queries. This is the backend
 * mirror of the frontend `plugins/search/services/searchIndex.ts:buildRecords`
 * — same kinds, same weighting intent, same route conventions — so the top-bar
 * (once it moves server-side), the `/api/search` endpoint and the AI
 * `searchModel` tool all describe the model the same way.
 *
 * Kept free of `node:sqlite` so it can be unit-tested in isolation and reused by
 * any index backend.
 */
import type { Package } from '../../models/Dictionary.js';
import type { Entity } from '../../models/EntitySchema.js';

export type SearchKind =
  | 'entity'
  | 'attribute'
  | 'package'
  | 'relationship'
  | 'rule'
  | 'metadata'
  | 'case'
  | 'document'
  | 'documentation-chunk';

export interface SearchDoc {
  /** Stable unique id (also the FTS rowid key + de-dupe key). */
  id: string;
  kind: SearchKind;
  /** Primary label — most heavily weighted for matching. */
  name: string;
  description: string;
  /** Owning package name ('' for project-level records). */
  package: string;
  /** Owning entity name for attribute / metadata / rule records. */
  entityName: string;
  /** Extra free text folded into matching (type, stereotype, parent…). */
  keywords: string;
  /** Router path to navigate to when the record is chosen. */
  route: string;
  /** Documentation provenance (empty for model records). */
  documentUuid?: string;
  chunkId?: string;
  headingPath?: string;
  sourcePath?: string;
  status?: string;
  language?: string;
  scope?: string;
  /** Exact-match facets, stored outside FTS. */
  facets?: Record<string, string[]>;
}

/**
 * Per-kind ranking tier — lower is more important. Mirrors the frontend
 * `KIND_TIER`: primary modelling objects (entity → attribute → package) float
 * above incidental matches of equal textual quality.
 */
export const KIND_TIER: Record<SearchKind, number> = {
  entity: 0,
  attribute: 1,
  package: 2,
  document: 2,
  'documentation-chunk': 3,
  relationship: 3,
  case: 3,
  rule: 3,
  metadata: 4,
};

/** Minimal structural types keep this converter independent of the parser implementation. */
export interface SearchableDocumentation {
  uuid: string;
  title: string;
  summary?: string;
  content?: string;
  scope: 'project' | 'package';
  packageName?: string;
  status?: string;
  language?: string;
  sourcePath: string;
  audience?: string[];
  tags?: string[];
  concepts?: string[];
  related?: Array<string | { ref: string }>;
}

export interface SearchableDocumentationChunk {
  id: string;
  documentUuid: string;
  title?: string;
  headingPath: string[];
  content: string;
  scope: 'project' | 'package';
  packageName?: string;
  sourcePath: string;
  status?: string;
  language?: string;
  audience?: string[];
  tags?: string[];
  concepts?: string[];
  descriptors?: string[];
  relatedRefs?: string[];
}

const documentationFacets = (item: SearchableDocumentation | SearchableDocumentationChunk) => ({
  audience: item.audience ?? [],
  tag: item.tags ?? [],
  concept: item.concepts ?? [],
  descriptor: (item as SearchableDocumentationChunk).descriptors ?? [],
  relatedRef: (item as SearchableDocumentationChunk).relatedRefs
    ?? ((item as SearchableDocumentation).related ?? []).map((r: string | { ref: string }) => typeof r === 'string' ? r : r.ref),
});

/** Flatten authored documents and replaceable chunks into retrieval records. */
export function documentationToSearchDocs(
  documents: SearchableDocumentation[],
  chunks: SearchableDocumentationChunk[],
): SearchDoc[] {
  const byUuid = new Map(documents.map((d) => [d.uuid, d]));
  const documentDocs = documents.map((d): SearchDoc => ({
    id: `document:${d.uuid}`,
    kind: 'document',
    name: d.title,
    description: d.summary ?? '',
    package: d.packageName ?? '',
    entityName: '',
    keywords: [d.content ?? '', ...(d.tags ?? []), ...(d.concepts ?? [])].join(' '),
    route: `/documentation/${d.uuid}`,
    documentUuid: d.uuid,
    sourcePath: d.sourcePath,
    status: d.status ?? '',
    language: d.language ?? '',
    scope: d.scope,
    facets: documentationFacets(d),
  }));
  const chunkDocs = chunks.map((c): SearchDoc => {
    const parent = byUuid.get(c.documentUuid);
    const heading = c.headingPath.join(' › ');
    return {
      id: `documentation-chunk:${c.id}`,
      kind: 'documentation-chunk',
      name: c.title || heading || parent?.title || 'Documentation',
      description: c.content,
      package: c.packageName ?? parent?.packageName ?? '',
      entityName: '',
      keywords: [...c.headingPath, ...(c.tags ?? []), ...(c.concepts ?? []), ...(c.descriptors ?? [])].join(' '),
      route: `/documentation/${c.documentUuid}#${encodeURIComponent(c.id.split('#').pop() ?? c.id)}`,
      documentUuid: c.documentUuid,
      chunkId: c.id,
      headingPath: c.headingPath.join(' / '),
      sourcePath: c.sourcePath,
      status: c.status ?? parent?.status ?? '',
      language: c.language ?? parent?.language ?? '',
      scope: c.scope,
      facets: documentationFacets(c),
    };
  });
  return [...documentDocs, ...chunkDocs];
}

const entityRoute = (pkg: string, entity: string) =>
  `/packages/${pkg}/entities/${entity}`;

/**
 * Split an identifier into its constituent words so a sub-word query matches.
 * FTS5 (unicode61) tokenizes on non-alphanumerics only, so `orderTotal` is one
 * token and a prefix query for `total` would miss it. Folding "order total"
 * into keywords makes the inner word findable. Handles camelCase, snake_case,
 * kebab-case and dotted names. Returns '' when nothing extra is gained.
 */
export function splitIdentifier(name: string): string {
  const parts = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ACRONYMWord boundary
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const joined = parts.join(' ').toLowerCase();
  // Only useful if it actually differs from the original single token.
  return joined && joined !== name.toLowerCase() ? joined : '';
}

/** Append the split-identifier form of `name` to a keyword string. */
const withSplit = (keywords: string, name: string): string => {
  const extra = splitIdentifier(name);
  return extra ? `${keywords} ${extra}`.trim() : keywords;
};

/**
 * Flatten one loaded package tree into search documents. `packagePath` is the
 * routable path from the root package (for example `sales/reference/codes`).
 * The dictionary loader returns subpackages nested under their root, so this
 * function must recurse; otherwise large hierarchical projects silently index
 * only their root-level entities.
 */
export function packageToSearchDocs(pkg: Package, packagePath: string = pkg.name): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const service = packagePath;

  docs.push({
    id: `package:${service}`,
    kind: 'package',
    name: service,
    description: pkg.description ?? '',
    package: service,
    entityName: '',
    keywords: `package ${pkg.type ?? ''}`.trim(),
    route: `/packages/${service}`,
  });

  for (const entity of pkg.entities ?? []) {
    const route = entityRoute(service, entity.name);
    docs.push({
      id: `entity:${service}:${entity.name}`,
      kind: 'entity',
      name: entity.name,
      description: entity.description ?? '',
      package: service,
      entityName: entity.name,
      keywords: withSplit(`entity ${entity.stereotype ?? ''} ${entity.status ?? ''}`.trim(), entity.name),
      route,
    });

    for (const attr of entity.attributes ?? []) {
      docs.push({
        id: `attr:${service}:${entity.name}:${attr.name}`,
        kind: 'attribute',
        name: attr.name,
        description: attr.description ?? '',
        package: service,
        entityName: entity.name,
        keywords: withSplit(`attribute ${entity.name} ${attr.type ?? ''}`.trim(), attr.name),
        route,
      });
    }

    for (const meta of entity.metadata ?? []) {
      docs.push({
        id: `meta:${service}:${entity.name}:${meta.name}`,
        kind: 'metadata',
        name: meta.name,
        description: String(meta.value ?? ''),
        package: service,
        entityName: entity.name,
        keywords: `metadata ${entity.name}`,
        route,
      });
    }

    // Inline entity-scoped rules (#106). Loosely typed — `rules` is `Rule[]`.
    for (const rule of (entity.rules ?? []) as Array<{ uuid?: string; name?: string; description?: string; expression?: string }>) {
      const rid = rule.uuid ?? `${entity.name}:${rule.name ?? 'rule'}`;
      docs.push({
        id: `rule:${service}:${rid}`,
        kind: 'rule',
        name: rule.name ?? 'rule',
        description: rule.description || rule.expression || '',
        package: service,
        entityName: entity.name,
        keywords: `rule ${entity.name}`,
        route,
      });
    }
  }

  for (const rel of pkg.relationships ?? []) {
    const label = rel.description || rel.type || 'relationship';
    docs.push({
      id: `rel:${service}:${rel.uuid}`,
      kind: 'relationship',
      name: label,
      description: rel.description ?? '',
      package: service,
      entityName: '',
      keywords: `relationship ${rel.type ?? ''} ${rel.stereotype ?? ''}`.trim(),
      route: `/packages/${service}`,
    });
  }

  for (const c of pkg.cases ?? []) {
    docs.push({
      id: `case:${c.uuid}`,
      kind: 'case',
      name: c.name,
      description: c.description ?? '',
      package: service,
      entityName: '',
      keywords: 'case',
      route: `/cases/${c.uuid}`,
    });
  }

  for (const subPackage of pkg.subPackages ?? []) {
    docs.push(...packageToSearchDocs(subPackage, `${packagePath}/${subPackage.name}`));
  }

  return docs;
}

/** Convenience for callers holding an entity list rather than a Package. */
export function entitiesToSearchDocs(pkgName: string, entities: Entity[]): SearchDoc[] {
  return packageToSearchDocs({
    id: pkgName,
    name: pkgName,
    entities,
    subPackages: [],
    relationships: [],
  } as Package);
}
