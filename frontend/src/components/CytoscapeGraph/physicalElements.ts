/**
 * Physical (table) view element builder (#186/#187).
 *
 * Renders a compact DB schema model derived from `physical.*` + `constraints[]`:
 *   - Node = table. Label = `physical.tableName` (fallback entity name), with
 *     `physical.schema` as a namespace subtitle. Compact — column / dbType /
 *     PK-FK-unique detail surfaces in the info panel (#188).
 *   - FK edges = `foreignKey` constraints, labelled with the join column(s).
 *   - Many-to-many = `orm.joinTable` rendered as a join-table node bridging the
 *     two sides with FK edges.
 *   - Logical↔physical drift warnings are overlaid by #187 (buildDriftEdges).
 *
 * Pure function of (nodes, edges, parentMapping) — unit-tested in isolation.
 */
import type { ElementDefinition } from 'cytoscape';
import type { GraphNode, GraphEdge } from '../../types';
import { readMetaString, readMetaFlag } from './elementMeta';
import { detectDrift, buildDriftEdges, pairKey } from './physicalDrift';

/**
 * Embeddable entities (`orm.embeddable`) have no table of their own — they are
 * mapped into the owner's table — so the physical view excludes them.
 */
export function isEmbeddable(node: GraphNode): boolean {
  return readMetaFlag(node.data?.metadata, 'orm.embeddable');
}

/** Table name shown on a physical node — `physical.tableName` else the entity name. */
export function physicalTableName(node: GraphNode): string {
  return readMetaString(node.data?.metadata, 'physical.tableName') || node.label;
}

/** DB schema namespace — `physical.schema`, or '' when unset. */
export function physicalSchema(node: GraphNode): string {
  return readMetaString(node.data?.metadata, 'physical.schema') || '';
}

/** Compact multi-line node label: table name · schema namespace. */
function physicalNodeLabel(tableName: string, schema: string): string {
  return schema ? `${tableName}\n${schema}` : tableName;
}

/**
 * Resolve a referenced table name to a node id. FK constraints reference a
 * table by its physical name; we match `physical.tableName` first, then fall
 * back to the entity name so unmapped entities still link up.
 */
export function buildTableIndex(nodes: GraphNode[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const n of nodes) {
    index.set(physicalTableName(n), n.id);
    index.set(n.label, n.id); // entity-name fallback
  }
  return index;
}

/**
 * FK edges from each entity's `foreignKey` constraints (#186). An FK whose
 * entity pair is in `inDbMissingKeys` (no matching logical relationship, #187)
 * is flagged as drift so the stylesheet renders it as a warning.
 */
export function buildFkEdges(
  nodes: GraphNode[],
  tableIndex: Map<string, string>,
  inDbMissingKeys: Set<string> = new Set(),
): ElementDefinition[] {
  const edges: ElementDefinition[] = [];
  for (const node of nodes) {
    const fks = (node.data?.constraints ?? []).filter((c) => c.kind === 'foreignKey');
    fks.forEach((fk, i) => {
      const refTable = fk.references?.table;
      if (!refTable) return;
      const targetId = tableIndex.get(refTable);
      if (!targetId || targetId === node.id) return; // off-canvas / self — skip
      const localCols = (fk.columns ?? []).join(', ');
      const refCols = (fk.references?.columns ?? []).join(', ');
      const baseLabel = localCols && refCols ? `${localCols} → ${refCols}` : localCols || refCols || 'FK';
      const driftInDb = inDbMissingKeys.has(pairKey(node.id, targetId));
      edges.push({
        group: 'edges',
        data: {
          id: `fk:${node.id}:${fk.name || `${i}`}`,
          source: node.id,
          target: targetId,
          edgeKind: 'fk',
          viewMode: 'physical',
          label: driftInDb ? `${baseLabel}\nin DB, missing from model` : baseLabel,
          constraintName: fk.name ?? '',
          // #187 drift flag: FK present in DB with no logical relationship.
          driftInDb,
          ...(driftInDb ? { driftKind: 'in-db-missing' } : {}),
          sourceEndLabel: '',
          targetEndLabel: '',
        },
      });
    });
  }
  return edges;
}

/**
 * Join-table nodes + their FK edges for many-to-many relationships (#186).
 * A relationship carrying `orm.joinTable` becomes a synthetic join-table node
 * bridging both endpoint tables, with the join / inverse-join columns labelling
 * each FK edge.
 */
export function buildJoinTables(edges: GraphEdge[], nodes: GraphNode[]): ElementDefinition[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: ElementDefinition[] = [];

  for (const edge of edges) {
    const joinTable = readMetaString(edge.metadata, 'orm.joinTable');
    if (!joinTable) continue;
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;

    const jtId = `jt:${edge.id}`;
    out.push({
      group: 'nodes',
      data: {
        id: jtId,
        label: joinTable,
        displayLabel: joinTable,
        type: 'jointable',
        viewMode: 'physical',
        description: `Join table for ${edge.label || 'many-to-many'}`,
      },
    });

    const joinColumns = readMetaString(edge.metadata, 'orm.joinColumns') || '';
    const inverseJoinColumns = readMetaString(edge.metadata, 'orm.inverseJoinColumns') || '';
    out.push({
      group: 'edges',
      data: {
        id: `fk:${jtId}:src`,
        source: jtId,
        target: edge.source,
        edgeKind: 'fk',
        viewMode: 'physical',
        label: joinColumns,
        sourceEndLabel: '',
        targetEndLabel: '',
      },
    });
    out.push({
      group: 'edges',
      data: {
        id: `fk:${jtId}:tgt`,
        source: jtId,
        target: edge.target,
        edgeKind: 'fk',
        viewMode: 'physical',
        label: inverseJoinColumns,
        sourceEndLabel: '',
        targetEndLabel: '',
      },
    });
  }
  return out;
}

export function buildPhysicalElements(
  nodes: GraphNode[],
  edges: GraphEdge[],
  parentMapping?: Record<string, string>,
): ElementDefinition[] {
  const elements: ElementDefinition[] = [];

  // Embeddables have no physical table — drop them from the table model entirely
  // (nodes, FK resolution, join tables and drift).
  const tableNodes = nodes.filter((n) => !isEmbeddable(n));

  for (const node of tableNodes) {
    const entity = node.data;
    const tableName = physicalTableName(node);
    const schema = physicalSchema(node);
    const pkCount = entity?.attributes?.filter((a) => a.primaryKey).length ?? 0;

    elements.push({
      group: 'nodes',
      data: {
        id: node.id,
        // `label` stays the entity name so node-click navigation still resolves.
        label: node.label,
        displayLabel: physicalNodeLabel(tableName, schema),
        service: node.service,
        type: 'entity',
        viewMode: 'physical',
        tableName,
        schema,
        attrCount: entity?.attributes?.length ?? 0,
        pkCount,
        description: entity?.description ?? '',
        // Carried for the info panel (#188): columns + PK/FK/unique constraints.
        attributes: entity?.attributes ?? [],
        constraints: entity?.constraints ?? [],
        expanded: false,
        ...(parentMapping?.[node.id] ? { parent: parentMapping[node.id] } : {}),
      },
    });
  }

  const tableIndex = buildTableIndex(tableNodes);

  // Logical↔physical drift overlay (#187), computed once and applied both ways:
  // FK-without-relationship flags the FK edge; relationship-without-FK adds a
  // dashed warning edge.
  const drift = detectDrift(tableNodes, edges, tableIndex);
  const inDbMissingKeys = new Set(
    drift.inDbMissing.map((p) => pairKey(p.sourceId, p.targetId)),
  );

  elements.push(...buildFkEdges(tableNodes, tableIndex, inDbMissingKeys));
  elements.push(...buildJoinTables(edges, tableNodes));
  elements.push(...buildDriftEdges(drift));

  return elements;
}
