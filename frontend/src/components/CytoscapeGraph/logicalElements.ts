/**
 * Logical (ORM) view element builder (#184/#185).
 *
 * Renders a compact class/object model derived from `orm.*`:
 *   - Node = class. Label = `orm.className` (fallback entity name), with the
 *     `orm.package` as a namespace subtitle and a `«@Embeddable»` /
 *     `«@MappedSuperclass»` stereotype line. Compact — no inline attribute
 *     lists; per-attribute ORM facts surface in the info panel (#188).
 *   - Association edges = relationships annotated with ORM runtime semantics:
 *     fetch (LAZY/EAGER), cascade, orphanRemoval, owning side and cardinality.
 *   - Inheritance (`orm.extends`) is rendered as a SEPARATE is-a edge (#185),
 *     never an association.
 *
 * Pure function of (nodes, edges, parentMapping) — unit-tested in isolation.
 */
import type { ElementDefinition } from 'cytoscape';
import type { GraphNode, GraphEdge } from '../../types';
import { formatEndLabel } from './mapGraphDataToCytoscape';
import { readMetaString, readMetaFlag, readMetaList } from './elementMeta';
import { mergeRelationshipEdges } from './mergeEdges';
import { associationArrows } from './arrowShapes';

export interface LogicalOptions {
  /** Show the ORM annotation (fetch · cascade · orphanRemoval) on association edges. */
  showAnnotations?: boolean;
}

/** The relationship facts the ORM helpers read — satisfied by GraphEdge and MergedGraphEdge. */
type EdgeOrmFacts = Pick<GraphEdge, 'metadata' | 'sourceName' | 'targetName'>;

/** Class name shown on a logical node — `orm.className` else the entity name. */
export function logicalClassName(node: GraphNode): string {
  return readMetaString(node.data?.metadata, 'orm.className') || node.label;
}

/** Stereotype badges from `orm.embeddable` / `orm.mappedSuperclass`. */
export function logicalBadges(node: GraphNode): string[] {
  const badges: string[] = [];
  if (readMetaFlag(node.data?.metadata, 'orm.embeddable')) badges.push('@Embeddable');
  if (readMetaFlag(node.data?.metadata, 'orm.mappedSuperclass')) badges.push('@MappedSuperclass');
  return badges;
}

/**
 * Inheritance strategy declared on a class (the `@Inheritance` on the root).
 * Surfaced on the node that declares it (#185).
 */
export function logicalInheritanceStrategy(node: GraphNode): string {
  return readMetaString(node.data?.metadata, 'orm.inheritanceStrategy') || '';
}

/** Compact multi-line node label: stereotype line · class name · package · strategy. */
function logicalNodeLabel(
  className: string,
  badges: string[],
  pkg?: string,
  inheritanceStrategy?: string,
): string {
  const lines: string[] = [];
  if (badges.length) lines.push(`«${badges.join(', ')}»`);
  lines.push(className);
  if (pkg) lines.push(pkg);
  // The root of an inheritance hierarchy shows its strategy (#185).
  if (inheritanceStrategy) lines.push(`{${inheritanceStrategy}}`);
  return lines.join('\n');
}

/**
 * Build the diagram-only inheritance ("is-a") edges from `orm.extends` (#185).
 *
 * Decision 5: inheritance is NOT a relationship — these edges are generated
 * here, never promoted to a relationship `type`, and never mixed with
 * associations. `orm.extends` is an entityRef (a uuid or an entity name); it is
 * resolved against the nodes by id first, then by name. Edges that can't be
 * resolved (parent off-canvas) are dropped.
 */
export function buildInheritanceEdges(nodes: GraphNode[]): ElementDefinition[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byName = new Map(nodes.map((n) => [n.label, n]));
  const edges: ElementDefinition[] = [];

  for (const child of nodes) {
    const ext = readMetaString(child.data?.metadata, 'orm.extends');
    if (!ext) continue;
    const parent = byId.get(ext) || byName.get(ext);
    if (!parent || parent.id === child.id) continue;
    edges.push({
      group: 'edges',
      data: {
        id: `isa:${child.id}->${parent.id}`,
        source: child.id,
        target: parent.id,
        edgeKind: 'inheritance',
        viewMode: 'logical',
        // No association annotation / cardinality on an is-a edge; the root's
        // strategy (if any) labels the edge so it reads at the superclass end.
        label: logicalInheritanceStrategy(parent),
        sourceEndLabel: '',
        targetEndLabel: '',
      },
    });
  }
  return edges;
}

/**
 * Resolve which end of an association owns the mapping (the FK / non-inverse
 * side), so the diagram can point the navigability arrow from it.
 *
 *   - `orm.owningEnd` names the owning end's role → that side owns.
 *   - else `orm.mappedBy` names the inverse end's role → the OTHER side owns.
 *
 * Returns `''` when the data doesn't pin it down (arrow stays at the target,
 * matching the structural default).
 */
export function logicalOwningSide(edge: EdgeOrmFacts): '' | 'source' | 'target' {
  const owningEnd = readMetaString(edge.metadata, 'orm.owningEnd');
  const mappedBy = readMetaString(edge.metadata, 'orm.mappedBy');
  const sourceRole = edge.sourceName;
  const targetRole = edge.targetName;

  if (owningEnd) {
    if (owningEnd === sourceRole) return 'source';
    if (owningEnd === targetRole) return 'target';
  }
  if (mappedBy) {
    // mappedBy names the inverse end → the opposite end owns.
    if (mappedBy === sourceRole) return 'target';
    if (mappedBy === targetRole) return 'source';
  }
  return '';
}

/** Compact ORM annotation for an association edge ("LAZY · cascade: ALL · orphan"). */
export function logicalEdgeAnnotation(edge: Pick<GraphEdge, 'metadata'>): string {
  const parts: string[] = [];
  const fetch = readMetaString(edge.metadata, 'orm.fetch');
  if (fetch) parts.push(fetch);
  const cascade = readMetaList(edge.metadata, 'orm.cascade');
  if (cascade.length) parts.push(`cascade: ${cascade.join(', ')}`);
  if (readMetaFlag(edge.metadata, 'orm.orphanRemoval')) parts.push('orphanRemoval');
  return parts.join(' · ');
}

export function buildLogicalElements(
  nodes: GraphNode[],
  edges: GraphEdge[],
  parentMapping?: Record<string, string>,
  options: LogicalOptions = {},
): ElementDefinition[] {
  const showAnnotations = options.showAnnotations ?? true;
  const elements: ElementDefinition[] = [];

  for (const node of nodes) {
    const entity = node.data;
    const className = logicalClassName(node);
    const badges = logicalBadges(node);
    const pkg = readMetaString(entity?.metadata, 'orm.package');
    const inheritanceStrategy = logicalInheritanceStrategy(node);
    const pkCount = entity?.attributes?.filter((a) => a.primaryKey).length ?? 0;

    elements.push({
      group: 'nodes',
      data: {
        id: node.id,
        // `label` stays the entity name so node-click navigation still resolves
        // /packages/<svc>/entities/<name>; `displayLabel` carries the rendered text.
        label: node.label,
        displayLabel: logicalNodeLabel(className, badges, pkg, inheritanceStrategy),
        service: node.service,
        type: 'entity',
        viewMode: 'logical',
        className,
        ormPackage: pkg ?? '',
        badges,
        inheritanceStrategy,
        attrCount: entity?.attributes?.length ?? 0,
        pkCount,
        description: entity?.description ?? '',
        // Carried for the info panel (#188): attributes keep their orm.* metadata.
        attributes: entity?.attributes ?? [],
        constraints: entity?.constraints ?? [],
        expanded: false,
        ...(parentMapping?.[node.id] ? { parent: parentMapping[node.id] } : {}),
      },
    });
  }

  // Merge reciprocal relationship records into one association edge per entity
  // pair; arrowheads follow navigability (a named end is navigable), so a
  // relationship navigable both ways renders as one double-headed edge (#bidi).
  for (const edge of mergeRelationshipEdges(edges)) {
    const owningSide = logicalOwningSide(edge);
    const cascade = readMetaList(edge.metadata, 'orm.cascade');
    // UML decoration: a filled diamond at the whole for a composition (strong
    // ownership / lifecycle), else navigability arrows for a plain reference —
    // bidirectional shows no arrowheads (#uml).
    const { sourceArrow, targetArrow, edgeType } = associationArrows(edge);
    elements.push({
      group: 'edges',
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        edgeKind: 'association',
        edgeType, // 'composition' | 'reference'
        viewMode: 'logical',
        // ORM annotation is optional (toggle) — empty hides it.
        label: showAnnotations ? logicalEdgeAnnotation(edge) : '',
        sourceCardinality: edge.sourceCardinality ?? '',
        targetCardinality: edge.targetCardinality ?? '',
        sourceName: edge.sourceName ?? '',
        targetName: edge.targetName ?? '',
        sourceEndLabel: formatEndLabel(edge.sourceName, edge.sourceCardinality),
        targetEndLabel: formatEndLabel(edge.targetName, edge.targetCardinality),
        // ORM runtime semantics for the info panel / styling.
        fetch: readMetaString(edge.metadata, 'orm.fetch') ?? '',
        cascade: cascade.join(', '),
        orphanRemoval: readMetaFlag(edge.metadata, 'orm.orphanRemoval'),
        optional: readMetaFlag(edge.metadata, 'orm.optional'),
        owningEnd: readMetaString(edge.metadata, 'orm.owningEnd') ?? '',
        mappedBy: readMetaString(edge.metadata, 'orm.mappedBy') ?? '',
        owningSide,
        // Arrowhead shapes read by the stylesheet ('none' | 'vee' | 'diamond').
        sourceArrow,
        targetArrow,
      },
    });
  }

  // Inheritance is-a edges (#185) — a distinct, diagram-only edge type, kept
  // separate from associations (Decision 5).
  elements.push(...buildInheritanceEdges(nodes));

  return elements;
}
