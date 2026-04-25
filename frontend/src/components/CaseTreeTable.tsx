import { useState, useMemo, useCallback, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ResolvedNode, ResolvedAttribute, MetadataEntry } from '../types';
import { Cardinality } from '../types';
import { useStereotypeMetadata, setMetadataValue } from '../hooks/useStereotypeMetadata';
import InlineMetadataCell from './InlineMetadataCell';
import { servicesApi } from '../services/api';
import type { Entity, Attribute } from '../types';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';
import { Button, Chip, Input, Menu, Toolbar, TreeTable, resetTreeTableWidths } from './ui';
import type { ColumnDef, TreeTableRow } from './ui';

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
 * Path contract (backend `caseService.resolve`): each path is a
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

const LOCALSTORAGE_KEY = 'case-tree-table-columns';

export default function CaseTreeTable({ nodes, onMetadataUpdated }: Props) {
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
  // hierarchy is visible on first view.
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

  // Flatten visible rows for TreeTable — a TreeTableRow per visible node,
  // with the indent / hasChildren / isExpanded / toggle ops resolved here.
  const treeRows = useMemo<TreeTableRow<TreeNode>[]>(() => {
    const result: TreeTableRow<TreeNode>[] = [];
    function walk(items: TreeNode[], indent: number) {
      for (const item of items) {
        if (matchingPaths && !matchingPaths.has(item.path)) continue;

        if (item.kind === 'entity') {
          const hasChildren = item.children.length > 0;
          const isExpanded = expanded.has(item.path);
          result.push({
            row: item,
            indent,
            hasChildren,
            isExpanded,
            toggle: () => toggle(item.path),
          });

          const showChildren = isExpanded || !!matchingPaths;
          if (!showChildren) continue;
          for (const child of item.children) {
            walk([child], indent + 1);
          }
        } else {
          // Attribute rows are leaves.
          result.push({
            row: item,
            indent,
            hasChildren: false,
            isExpanded: false,
            toggle: () => { /* no-op */ },
          });
        }
      }
    }
    walk(tree, 0);
    return result;
  }, [tree, expanded, matchingPaths, toggle]);

  // Save metadata callbacks — passed to InlineMetadataCell renderers.
  const handleEntityMeta = useCallback(async (rn: ResolvedNode, name: string, value: string | number | boolean) => {
    try {
      await saveEntityMeta(rn.service, rn.entityName, name, value);
      onMetadataUpdated?.();
    } catch (err) {
      console.error('Failed to save entity metadata:', err);
    }
  }, [onMetadataUpdated]);

  const handleAttrMeta = useCallback(async (n: TreeNode, name: string, value: string | number | boolean) => {
    if (!n.ownerService || !n.ownerEntityName || !n.attribute) return;
    try {
      await saveAttrMeta(n.ownerService, n.ownerEntityName, n.attribute.name, name, value);
      onMetadataUpdated?.();
    } catch (err) {
      console.error('Failed to save attribute metadata:', err);
    }
  }, [onMetadataUpdated]);

  const columns: ColumnDef<TreeNode>[] = useMemo(() => {
    const std: ColumnDef<TreeNode>[] = [
      {
        key: 'entity',
        header: 'Entity / Attribute',
        group: 'standard',
        width: 300,
        render: (n) => renderTreeLabel(n),
      },
      {
        key: 'type',
        header: 'Type',
        group: 'standard',
        width: 80,
        render: (n) => n.kind === 'attribute' && n.attribute
          ? <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{n.attribute.type}</span>
          : null,
      },
      {
        key: 'service',
        header: 'Service',
        group: 'standard',
        width: 120,
        render: (n) => n.kind === 'entity' && n.node
          ? <Chip tone="neutral">{n.node.service}</Chip>
          : null,
      },
      {
        key: 'hops',
        header: 'Hops',
        group: 'standard',
        width: 50,
        align: 'center',
        render: (n) => n.kind === 'entity' && n.node ? n.node.hopDistance : null,
      },
      {
        key: 'status',
        header: 'Status',
        group: 'standard',
        width: 100,
        render: (n) => {
          if (n.kind !== 'entity' || !n.node) return null;
          const rn = n.node;
          return (
            <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
              {rn.isRoot && <Chip tone="accent">root</Chip>}
              {rn.isFrontier && <Chip tone="warning">frontier</Chip>}
              {rn.isManualInclusion && <Chip tone="info">included</Chip>}
            </span>
          );
        },
      },
    ];

    const meta: ColumnDef<TreeNode>[] = activeMetaCols.map((col) => {
      const colKey = `${col.target}:${col.name}`;
      return {
        key: colKey,
        header: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={col.description}>
            {col.label}
            <Chip tone="neutral">{col.target === 'entity' ? 'E' : 'A'}</Chip>
          </span>
        ),
        group: 'metadata',
        width: 120,
        render: (n) => {
          // Only render the inline editor when the row's kind matches the
          // column's target — opposite-target cells stay blank ("—").
          if (col.target === 'entity' && n.kind === 'entity' && n.node) {
            return (
              <InlineMetadataCell
                value={getMetaVal(n.node.metadata, col.name)}
                column={col}
                onChange={(v) => handleEntityMeta(n.node!, col.name, v)}
              />
            );
          }
          if (col.target === 'attribute' && n.kind === 'attribute' && n.attribute) {
            return (
              <InlineMetadataCell
                value={getMetaVal(n.attribute.metadata, col.name)}
                column={col}
                onChange={(v) => handleAttrMeta(n, col.name, v)}
              />
            );
          }
          return <span style={{ color: 'var(--text-subtle)' }}>—</span>;
        },
      };
    });

    return [...std, ...meta];
  }, [activeMetaCols, handleEntityMeta, handleAttrMeta]);

  return (
    <div className="flex flex-col gap-2">
      <Toolbar attached>
        <Input
          icon="search"
          size="sm"
          placeholder="Filter entities or attributes…"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
          width={240}
        />
        <Button size="sm" variant="ghost" onClick={expandAll}>Expand all</Button>
        <Button size="sm" variant="ghost" onClick={collapseAll}>Collapse all</Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => resetTreeTableWidths('case-tree')}
          title="Reset column widths"
        >
          Reset cols
        </Button>

        <Toolbar.Spacer />

        {/* Metadata column picker (#93) — entity/attribute target groups
            don't fit the standard ColumnChooser API, so we keep a custom
            body wrapped in the shared Menu primitive. */}
        {allMetaCols.length > 0 && (
          <Menu
            align="end"
            width={260}
            trigger={({ open, toggle }) => (
              <Button
                size="sm"
                variant="secondary"
                icon="columns"
                pressed={open}
                onClick={toggle}
              >
                Columns
                {activeMetaCols.length > 0 && (
                  <span style={{ marginLeft: 6 }}>
                    <Chip tone="accent" soft>{activeMetaCols.length}</Chip>
                  </span>
                )}
              </Button>
            )}
          >
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {Object.keys(entityColsByS).length > 0 && (
                <SectionLabel>Entity metadata</SectionLabel>
              )}
              {Object.entries(entityColsByS).map(([stId, cols]) => {
                const allOn = cols.every(c => visibleMetaCols.has(`entity:${c.name}`));
                return (
                  <ChooserGroup
                    key={`e-${stId}`}
                    title={cols[0]?.stereotypeName || stId}
                    allOn={allOn}
                    onToggleGroup={() => toggleMetaGroup(cols.map(c => ({ ...c, name: `entity:${c.name}` })) as any)}
                    items={cols.map(col => ({
                      key: col.name,
                      label: col.label,
                      checked: visibleMetaCols.has(`entity:${col.name}`),
                      onToggle: () => toggleMetaCol(`entity:${col.name}`),
                    }))}
                  />
                );
              })}
              {Object.keys(attrColsByS).length > 0 && (
                <SectionLabel divider>Attribute metadata</SectionLabel>
              )}
              {Object.entries(attrColsByS).map(([stId, cols]) => {
                const allOn = cols.every(c => visibleMetaCols.has(`attribute:${c.name}`));
                return (
                  <ChooserGroup
                    key={`a-${stId}`}
                    title={cols[0]?.stereotypeName || stId}
                    allOn={allOn}
                    onToggleGroup={() => toggleMetaGroup(cols.map(c => ({ ...c, name: `attribute:${c.name}` })) as any)}
                    items={cols.map(col => ({
                      key: col.name,
                      label: col.label,
                      checked: visibleMetaCols.has(`attribute:${col.name}`),
                      onToggle: () => toggleMetaCol(`attribute:${col.name}`),
                    }))}
                  />
                );
              })}
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: '1px solid var(--border)',
                }}
              >
                <Button size="sm" variant="ghost" onClick={() => updateVisibleCols(new Set(allMetaCols.map(c => `${c.target}:${c.name}`)))}>All</Button>
                <Button size="sm" variant="ghost" onClick={() => updateVisibleCols(new Set())}>None</Button>
              </div>
            </div>
          </Menu>
        )}
        {allMetaCols.length === 0 && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
            {nodes.length} nodes
          </span>
        )}
      </Toolbar>

      <TreeTable<TreeNode>
        columns={columns}
        rows={treeRows}
        getRowKey={(n) => n.path}
        treeColumnKey="entity"
        resizeKey="case-tree"
        stickyHeader
        stickyFirstColumn
        attached
        emptyMessage={filter ? 'No matching entities found' : 'No resolved paths'}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Cell renderers
// ────────────────────────────────────────────────────────────────────────

/**
 * Tree column label — entity link with optional nav prefix, or attribute
 * name with PK / required markers.
 */
function renderTreeLabel(n: TreeNode): ReactNode {
  if (n.kind === 'entity' && n.node) {
    const rn = n.node;
    const card = formatCardinality(rn.navCardinality);
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)' }}>
        {rn.navName && (
          <span style={{ color: 'var(--text-muted)' }}>
            <span style={{ fontStyle: 'italic' }}>{rn.navName}</span>
            {card && <span style={{ color: 'var(--text-subtle)', marginLeft: 4 }}>({card})</span>}
            <span style={{ color: 'var(--text-subtle)', margin: '0 4px' }}>→</span>
          </span>
        )}
        <Link
          to={`/packages/${rn.service}/entities/${rn.entityName}`}
          style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {rn.entityName}
        </Link>
      </span>
    );
  }
  if (n.kind === 'attribute' && n.attribute) {
    const attr = n.attribute;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
        <span className="mono">{attr.name}</span>
        {attr.primaryKey && <Chip tone="accent">PK</Chip>}
        {attr.required && !attr.primaryKey && <Chip tone="neutral">required</Chip>}
      </span>
    );
  }
  return null;
}

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

// ──────────────── Column-chooser helpers ────────────────

const SectionLabel = ({ children, divider }: { children: React.ReactNode; divider?: boolean }) => (
  <div
    className="uppercase"
    style={{
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-subtle)',
      letterSpacing: '0.06em',
      fontWeight: 600,
      padding: '6px 8px 4px',
      marginTop: divider ? 6 : 0,
      borderTop: divider ? '1px solid var(--border)' : undefined,
      paddingTop: divider ? 8 : 6,
    }}
  >
    {children}
  </div>
);

interface ChooserItem {
  key: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
}

interface ChooserGroupProps {
  title: string;
  allOn: boolean;
  onToggleGroup: () => void;
  items: ChooserItem[];
}

const ChooserGroup = ({ title, allOn, onToggleGroup, items }: ChooserGroupProps) => (
  <div style={{ marginBottom: 6 }}>
    <ChooserRow checked={allOn} onToggle={onToggleGroup} bold>
      {title}
    </ChooserRow>
    {items.map(item => (
      <ChooserRow key={item.key} checked={item.checked} onToggle={item.onToggle} indent>
        {item.label}
      </ChooserRow>
    ))}
  </div>
);

interface ChooserRowProps {
  checked: boolean;
  onToggle: () => void;
  bold?: boolean;
  indent?: boolean;
  children: React.ReactNode;
}

const ChooserRow = ({ checked, onToggle, bold, indent, children }: ChooserRowProps) => (
  <button
    type="button"
    role="menuitemcheckbox"
    aria-checked={checked}
    onClick={onToggle}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      width: '100%',
      textAlign: 'left',
      padding: indent ? '3px 8px 3px 24px' : '4px 8px',
      fontSize: 'var(--fs-sm)',
      fontWeight: bold ? 600 : 400,
      color: 'var(--text)',
      background: 'transparent',
      border: 'none',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
    }}
    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
  >
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        borderRadius: 3,
        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
        background: checked ? 'var(--accent)' : 'transparent',
        color: 'var(--accent-fg)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {checked && (
        <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12 5 5L20 7" />
        </svg>
      )}
    </span>
    <span style={{ flex: 1 }}>{children}</span>
  </button>
);
