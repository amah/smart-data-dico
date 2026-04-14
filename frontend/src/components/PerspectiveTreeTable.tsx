import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { ResolvedNode, ResolvedAttribute, MetadataEntry } from '../types';
import { Cardinality } from '../types';
import { useStereotypeMetadata, setMetadataValue } from '../hooks/useStereotypeMetadata';
import InlineMetadataCell from './InlineMetadataCell';
import { servicesApi } from '../services/api';
import type { Entity, Attribute } from '../types';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';

// ────────────────────────────────────────────────────────────────────────
// Tree data model
// ────────────────────────────────────────────────────────────────────────

/**
 * A row in the tree. `kind` distinguishes entity rows (default) from
 * attribute leaf rows so we can render them differently and exclude
 * attributes from filter/expand-all semantics.
 */
export interface TreeNode {
  /** Unique key for React — path string for entities, `<path>#attr:<name>` for attrs. */
  path: string;
  kind: 'entity' | 'attribute';
  /** Entity name (kind=entity) or attribute name (kind=attribute). */
  label: string;
  /** Resolved backend node — only set on entity rows. */
  node: ResolvedNode | null;
  /** Attribute payload — only set on attribute rows. */
  attribute: ResolvedAttribute | null;
  /** For attribute rows: the owning entity's service + name (for API saves). */
  ownerService?: string;
  ownerEntityName?: string;
  children: TreeNode[];
  depth: number;
}

/**
 * UML cardinality notation: 'one' → '1', 'many' → '*'. Used to render the
 * nav edge inline on each non-root entity row.
 */
function formatCardinality(card?: { from: Cardinality; to: Cardinality }): string | null {
  if (!card) return null;
  const short = (c: Cardinality) => (c === Cardinality.ONE ? '1' : '*');
  return `${short(card.from)}..${short(card.to)}`;
}

/**
 * Build a tree from the flat resolved-node array.
 *
 * Path contract (backend `perspectiveService.resolve`): each path is a
 * sequence `"<rootEntityName>/<nav1>/<nav2>/…"` where `<navN>` is the
 * relationship end-name of hop N. Parent lookup strips one trailing
 * segment — the contract is NOT an alternating entity/nav pattern.
 *
 * Each entity row also carries its attributes as synthetic leaf children
 * (kind='attribute') so the user can expand an entity to inspect its
 * fields without a round-trip. Attribute leaves are filtered out of the
 * "expand all" traversal (they're data-level, not graph-level) so
 * expand-all doesn't pop thousands of rows at once.
 */
function buildTree(nodes: ResolvedNode[]): TreeNode[] {
  // Sort by hopDistance first (parents before children), then by path for
  // stable ordering among siblings.
  const sorted = [...nodes].sort((a, b) => {
    if (a.hopDistance !== b.hopDistance) return a.hopDistance - b.hopDistance;
    return a.path.localeCompare(b.path);
  });

  const root: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();

  for (const n of sorted) {
    const segments = n.path.split('/');
    const treeNode: TreeNode = {
      path: n.path,
      kind: 'entity',
      label: n.entityName,
      node: n,
      attribute: null,
      children: [],
      depth: n.hopDistance,
    };
    nodeMap.set(n.path, treeNode);

    // Attribute leaves as children of this entity row.
    for (const attr of n.attributes || []) {
      treeNode.children.push({
        path: `${n.path}#attr:${attr.name}`,
        kind: 'attribute',
        label: attr.name,
        node: null,
        attribute: attr,
        ownerService: n.service,
        ownerEntityName: n.entityName,
        children: [],
        depth: n.hopDistance + 1,
      });
    }

    if (n.isRoot || segments.length <= 1) {
      root.push(treeNode);
      continue;
    }

    // Parent path drops the trailing nav segment.
    const parentPath = segments.slice(0, -1).join('/');
    const parentNode = nodeMap.get(parentPath);

    if (parentNode) {
      parentNode.children.push(treeNode);
    } else {
      // Defensive fallback: out-of-order or orphaned node — keep it visible
      // at the top level so nothing silently disappears from the UI.
      root.push(treeNode);
    }
  }

  return root;
}

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

interface Props {
  nodes: ResolvedNode[];
  /** Called after a metadata value is saved, so the parent can re-resolve. */
  onMetadataUpdated?: () => void;
}

const LOCALSTORAGE_KEY = 'perspective-tree-table-columns';

export default function PerspectiveTreeTable({ nodes, onMetadataUpdated }: Props) {
  const tree = useMemo(() => buildTree(nodes), [nodes]);

  // Metadata-as-columns (#93) — dual-target: entity + attribute stereotypes
  const { allColumns: entityCols, columnsByStereotype: entityColsByS } = useStereotypeMetadata('entity');
  const { allColumns: attrCols, columnsByStereotype: attrColsByS } = useStereotypeMetadata('attribute');
  const [visibleMetaCols, setVisibleMetaCols] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(LOCALSTORAGE_KEY);
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set<string>();
  });
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  // Persist column visibility
  const updateVisibleCols = useCallback((next: Set<string>) => {
    setVisibleMetaCols(next);
    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify([...next]));
  }, []);

  const toggleMetaCol = useCallback((name: string) => {
    setVisibleMetaCols(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const toggleMetaGroup = useCallback((cols: MetadataColumn[]) => {
    setVisibleMetaCols(prev => {
      const allOn = cols.every(c => prev.has(c.name));
      const next = new Set(prev);
      for (const col of cols) {
        if (allOn) next.delete(col.name);
        else next.add(col.name);
      }
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Merge both targets into one unified column set for the header row.
  // Column name may collide across targets (e.g. both entity + attribute have
  // "data-owner") — disambiguate by prefixing with a target marker.
  const allMetaCols = useMemo<(MetadataColumn & { target: 'entity' | 'attribute' })[]>(() => [
    ...entityCols.map(c => ({ ...c, target: 'entity' as const })),
    ...attrCols.map(c => ({ ...c, target: 'attribute' as const })),
  ], [entityCols, attrCols]);

  const activeMetaCols = allMetaCols.filter(c => visibleMetaCols.has(`${c.target}:${c.name}`));

  // Single expansion dimension: a path in this Set means "show all my
  // children (both entity descendants and attribute leaves)". Default:
  // entities that have entity children start expanded so the graph
  // hierarchy is visible on first view. The earlier two-set approach
  // (separate entity/attr expansion) created non-toggleable states.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    function walk(items: TreeNode[]) {
      for (const item of items) {
        if (item.kind !== 'entity') continue;
        const hasChildEntities = item.children.some(c => c.kind === 'entity');
        if (hasChildEntities) {
          initial.add(item.path);
          walk(item.children);
        }
      }
    }
    walk(tree);
    return initial;
  });

  // Search filter
  const [filter, setFilter] = useState('');

  const toggle = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<string>();
    function walk(items: TreeNode[]) {
      for (const item of items) {
        if (item.kind !== 'entity') continue;
        if (item.children.length > 0) {
          all.add(item.path);
          walk(item.children);
        }
      }
    }
    walk(tree);
    setExpanded(all);
  }, [tree]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  // Filter: find matching nodes and keep their ancestors visible.
  // Attribute matches also count — e.g. typing "email" surfaces every
  // entity that has an `email` attribute, with that attribute row shown.
  const matchingPaths = useMemo(() => {
    if (!filter.trim()) return null;
    const term = filter.toLowerCase();
    const matches = new Set<string>();
    function markAncestors(path: string) {
      const entityPath = path.split('#')[0];
      const segments = entityPath.split('/');
      for (let i = 1; i <= segments.length; i++) {
        matches.add(segments.slice(0, i).join('/'));
      }
      matches.add(path);
    }
    function walk(items: TreeNode[]) {
      for (const item of items) {
        if (item.kind === 'entity' && item.node) {
          const label = item.node.entityName;
          if (
            label.toLowerCase().includes(term) ||
            item.node.service.toLowerCase().includes(term)
          ) {
            markAncestors(item.path);
          }
        } else if (item.kind === 'attribute' && item.attribute) {
          if (item.attribute.name.toLowerCase().includes(term)) {
            markAncestors(item.path);
          }
        }
        walk(item.children);
      }
    }
    walk(tree);
    return matches;
  }, [tree, filter]);

  // Flatten visible rows for rendering.
  // An entity's children (both entity descendants and attribute leaves)
  // render iff the entity's path is in `expanded` OR a filter is active.
  const rows = useMemo(() => {
    const result: { node: TreeNode; indent: number; hasChildren: boolean; isExpanded: boolean }[] = [];
    function walk(items: TreeNode[], indent: number) {
      for (const item of items) {
        if (matchingPaths && !matchingPaths.has(item.path)) continue;

        if (item.kind === 'entity') {
          const hasChildren = item.children.length > 0;
          const isExpanded = expanded.has(item.path);
          result.push({ node: item, indent, hasChildren, isExpanded });

          const showChildren = isExpanded || !!matchingPaths;
          if (!showChildren) continue;
          for (const child of item.children) {
            walk([child], indent + 1);
          }
        } else {
          // Attribute rows never have their own children — render flat.
          result.push({ node: item, indent, hasChildren: false, isExpanded: false });
        }
      }
    }
    walk(tree, 0);
    return result;
  }, [tree, expanded, matchingPaths]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter entities or attributes..."
          className="input input-sm input-bordered flex-1 max-w-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className="btn btn-xs btn-ghost" onClick={expandAll}>Expand all</button>
        <button className="btn btn-xs btn-ghost" onClick={collapseAll}>Collapse all</button>

        {/* Metadata column picker (#93) */}
        {allMetaCols.length > 0 && (
          <div className="relative ml-auto">
            <button
              className="btn btn-xs btn-outline gap-1"
              onClick={() => setShowColumnPicker(!showColumnPicker)}
            >
              Columns
              {activeMetaCols.length > 0 && (
                <span className="badge badge-xs badge-primary">{activeMetaCols.length}</span>
              )}
            </button>
            {showColumnPicker && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg p-3 min-w-[250px] max-h-[400px] overflow-y-auto">
                {Object.keys(entityColsByS).length > 0 && (
                  <div className="text-xs font-bold text-base-content/50 mb-1">Entity metadata</div>
                )}
                {Object.entries(entityColsByS).map(([stId, cols]) => {
                  const allOn = cols.every(c => visibleMetaCols.has(`entity:${c.name}`));
                  return (
                    <div key={`e-${stId}`} className="mb-2">
                      <label className="flex items-center gap-2 font-semibold text-sm cursor-pointer mb-1">
                        <input type="checkbox" className="checkbox checkbox-xs checkbox-primary"
                          checked={allOn}
                          onChange={() => toggleMetaGroup(cols.map(c => ({ ...c, name: `entity:${c.name}` })) as any)}
                        />
                        {cols[0]?.stereotypeName || stId}
                      </label>
                      {cols.map(col => (
                        <label key={col.name} className="flex items-center gap-2 ml-4 text-sm cursor-pointer">
                          <input type="checkbox" className="checkbox checkbox-xs"
                            checked={visibleMetaCols.has(`entity:${col.name}`)}
                            onChange={() => toggleMetaCol(`entity:${col.name}`)}
                          />
                          {col.label}
                        </label>
                      ))}
                    </div>
                  );
                })}
                {Object.keys(attrColsByS).length > 0 && (
                  <div className="text-xs font-bold text-base-content/50 mt-2 mb-1 border-t border-base-300 pt-2">Attribute metadata</div>
                )}
                {Object.entries(attrColsByS).map(([stId, cols]) => {
                  const allOn = cols.every(c => visibleMetaCols.has(`attribute:${c.name}`));
                  return (
                    <div key={`a-${stId}`} className="mb-2">
                      <label className="flex items-center gap-2 font-semibold text-sm cursor-pointer mb-1">
                        <input type="checkbox" className="checkbox checkbox-xs checkbox-primary"
                          checked={allOn}
                          onChange={() => toggleMetaGroup(cols.map(c => ({ ...c, name: `attribute:${c.name}` })) as any)}
                        />
                        {cols[0]?.stereotypeName || stId}
                      </label>
                      {cols.map(col => (
                        <label key={col.name} className="flex items-center gap-2 ml-4 text-sm cursor-pointer">
                          <input type="checkbox" className="checkbox checkbox-xs"
                            checked={visibleMetaCols.has(`attribute:${col.name}`)}
                            onChange={() => toggleMetaCol(`attribute:${col.name}`)}
                          />
                          {col.label}
                        </label>
                      ))}
                    </div>
                  );
                })}
                <div className="border-t border-base-300 mt-2 pt-2 flex gap-2">
                  <button className="btn btn-xs" onClick={() => updateVisibleCols(new Set(allMetaCols.map(c => `${c.target}:${c.name}`)))}>All</button>
                  <button className="btn btn-xs" onClick={() => updateVisibleCols(new Set())}>None</button>
                </div>
              </div>
            )}
          </div>
        )}
        {allMetaCols.length === 0 && (
          <span className="text-xs text-base-content/50 ml-auto">{nodes.length} nodes</span>
        )}
      </div>

      {/* Tree table */}
      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Entity / Attribute</th>
              <th>Type</th>
              <th>Service</th>
              <th>Hops</th>
              <th>Status</th>
              {activeMetaCols.map(col => (
                <th key={`${col.target}:${col.name}`} title={col.description}>
                  <span className="flex items-center gap-1">
                    {col.label}
                    <span className="badge badge-xs badge-ghost font-normal">{col.target === 'entity' ? 'E' : 'A'}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ node: treeNode, indent, hasChildren, isExpanded }) => {
              if (treeNode.kind === 'attribute') {
                return (
                  <AttributeRow
                    key={treeNode.path}
                    treeNode={treeNode}
                    indent={indent}
                    metaCols={activeMetaCols}
                    onMetadataUpdated={onMetadataUpdated}
                  />
                );
              }
              return (
                <EntityRow
                  key={treeNode.path}
                  treeNode={treeNode}
                  indent={indent}
                  hasChildren={hasChildren}
                  isExpanded={isExpanded}
                  onToggle={() => toggle(treeNode.path)}
                  metaCols={activeMetaCols}
                  onMetadataUpdated={onMetadataUpdated}
                />
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5 + activeMetaCols.length} className="text-center text-base-content/50 py-8">
                  {filter ? 'No matching entities found' : 'No resolved paths'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Row components
// ────────────────────────────────────────────────────────────────────────

/**
 * Entity row. For non-roots, the nav prefix appears on the same line
 * as the entity name: `navName (1..*) → EntityName`. Roots render as a
 * plain entity name — no prefix.
 */
/**
 * Lookup a metadata value from a raw MetadataEntry array.
 */
function getMetaVal(metadata: MetadataEntry[] | undefined, name: string): string | number | boolean | undefined {
  return (metadata || []).find(m => m.name === name)?.value;
}

/**
 * Save entity-level metadata: fetch → merge → PUT.
 */
async function saveEntityMeta(
  service: string,
  entityName: string,
  metaName: string,
  value: string | number | boolean,
): Promise<void> {
  const response = await servicesApi.getEntitySchema(service, entityName);
  const entity: Entity = response.data;
  entity.metadata = setMetadataValue(entity.metadata, metaName, value);
  await servicesApi.updateEntity(service, entityName, entity);
}

/**
 * Save attribute-level metadata: fetch entity → find attr → merge → PUT.
 */
async function saveAttrMeta(
  service: string,
  entityName: string,
  attrName: string,
  metaName: string,
  value: string | number | boolean,
): Promise<void> {
  const response = await servicesApi.getEntitySchema(service, entityName);
  const entity: Entity = response.data;
  const attr = (entity.attributes || []).find((a: Attribute) => a.name === attrName);
  if (!attr) return;
  attr.metadata = setMetadataValue(attr.metadata, metaName, value);
  await servicesApi.updateEntity(service, entityName, entity);
}

function EntityRow({
  treeNode,
  indent,
  hasChildren,
  isExpanded,
  onToggle,
  metaCols,
  onMetadataUpdated,
}: {
  treeNode: TreeNode;
  indent: number;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  metaCols: (MetadataColumn & { target: 'entity' | 'attribute' })[];
  onMetadataUpdated?: () => void;
}) {
  const rn = treeNode.node!;
  const card = formatCardinality(rn.navCardinality);
  return (
    <tr className="hover">
      <td>
        <div
          className="flex items-center gap-1 text-sm"
          style={{ paddingLeft: `${indent * 1.25}rem` }}
        >
          {hasChildren ? (
            <button
              className="btn btn-ghost btn-xs px-0 min-h-0 h-5 w-5"
              onClick={onToggle}
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              <svg
                className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <span className="w-5" />
          )}

          {rn.navName && (
            <span className="text-base-content/60">
              <span className="italic">{rn.navName}</span>
              {card && <span className="text-base-content/40 ml-1">({card})</span>}
              <span className="text-base-content/40 mx-1">→</span>
            </span>
          )}
          <Link
            to={`/packages/${rn.service}/entities/${rn.entityName}`}
            className="link link-primary font-semibold"
          >
            {rn.entityName}
          </Link>
        </div>
      </td>
      <td />
      <td>
        <span className="badge badge-ghost badge-sm">{rn.service}</span>
      </td>
      <td>{rn.hopDistance}</td>
      <td>
        {rn.isRoot && <span className="badge badge-primary badge-sm mr-1">root</span>}
        {rn.isFrontier && <span className="badge badge-warning badge-sm mr-1">frontier</span>}
        {rn.isManualInclusion && <span className="badge badge-info badge-sm">included</span>}
      </td>
      {metaCols.map(col => {
        if (col.target !== 'entity') {
          return <td key={`${col.target}:${col.name}`} className="text-base-content/20 text-center">—</td>;
        }
        return (
          <td key={`${col.target}:${col.name}`}>
            <InlineMetadataCell
              value={getMetaVal(rn.metadata, col.name)}
              column={col}
              onChange={async (v) => {
                try {
                  await saveEntityMeta(rn.service, rn.entityName, col.name, v);
                  onMetadataUpdated?.();
                } catch (err) {
                  console.error('Failed to save entity metadata:', err);
                }
              }}
            />
          </td>
        );
      })}
    </tr>
  );
}

/**
 * Attribute leaf row. No expand chevron, no entity link — just name ·
 * type with PK / required markers.
 */
function AttributeRow({
  treeNode,
  indent,
  metaCols,
  onMetadataUpdated,
}: {
  treeNode: TreeNode;
  indent: number;
  metaCols: (MetadataColumn & { target: 'entity' | 'attribute' })[];
  onMetadataUpdated?: () => void;
}) {
  const attr = treeNode.attribute!;
  return (
    <tr className="hover">
      <td>
        <div
          className="flex items-center gap-1 text-xs text-base-content/80"
          style={{ paddingLeft: `${indent * 1.25 + 0.5}rem` }}
        >
          <span className="w-5 text-base-content/30">·</span>
          <span className="font-mono">{attr.name}</span>
          {attr.primaryKey && <span className="badge badge-primary badge-xs ml-1">PK</span>}
          {attr.required && !attr.primaryKey && (
            <span className="badge badge-ghost badge-xs ml-1">required</span>
          )}
        </div>
      </td>
      <td className="text-xs font-mono text-base-content/60">{attr.type}</td>
      <td />
      <td />
      <td />
      {metaCols.map(col => {
        if (col.target !== 'attribute') {
          return <td key={`${col.target}:${col.name}`} className="text-base-content/20 text-center">—</td>;
        }
        return (
          <td key={`${col.target}:${col.name}`}>
            <InlineMetadataCell
              value={getMetaVal(attr.metadata, col.name)}
              column={col}
              onChange={async (v) => {
                if (!treeNode.ownerService || !treeNode.ownerEntityName) return;
                try {
                  await saveAttrMeta(treeNode.ownerService, treeNode.ownerEntityName, attr.name, col.name, v);
                  onMetadataUpdated?.();
                } catch (err) {
                  console.error('Failed to save attribute metadata:', err);
                }
              }}
            />
          </td>
        );
      })}
    </tr>
  );
}
