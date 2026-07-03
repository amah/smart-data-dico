/**
 * Element Style post-process (#element-style). After the view builders produce
 * the Cytoscape elements, this single pass resolves each entity/table node's
 * effective style — from its explicit override, a style rule, a detected role
 * (junction / FK-target reference / cross-repo remote-ref), or its stereotype —
 * and stamps `styleName` (+ `styleBadge`) onto the node `data` so the generated
 * `node[styleName="…"]` selectors apply. Keeping it a pure post-pass leaves the
 * builders untouched and scales O(nodes + fk-edges).
 */
import type { ElementDefinition } from 'cytoscape';
import type { GraphNode } from '../../types';
import { resolveElementStyle, type ElementStyle, type CompiledStyleRule, type RoleSignals } from '../../utils/elementStyle';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function meta(entity: any, key: string): unknown {
  return entity?.metadata?.find((m: { name: string }) => m.name === key)?.value;
}

/** True when the entity is a cross-repo / cross-package target (reverse-engineer
 *  stamps `re.repos`; more than one repo → it lives beyond this package). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRemote(entity: any): boolean {
  const repos = meta(entity, 're.repos');
  return Array.isArray(repos) ? repos.length > 1 : typeof repos === 'string' && repos.includes(',');
}

/**
 * Stamp `styleName`/`styleBadge` onto entity + jointable nodes. Mutates and returns
 * `elements`. No-op when there are no styles defined.
 */
export function applyElementStyles(
  elements: ElementDefinition[],
  nodes: GraphNode[],
  styles: ElementStyle[],
  compiledRules: CompiledStyleRule[],
): ElementDefinition[] {
  if (!styles.length) return elements;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // FK in/out degree from the fk edges the builders emitted.
  const fkIn = new Map<string, number>();
  const fkOut = new Map<string, number>();
  for (const e of elements) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = e.data as any;
    if (e.group === 'edges' && d?.edgeKind === 'fk' && d.source && d.target) {
      fkOut.set(d.source, (fkOut.get(d.source) ?? 0) + 1);
      fkIn.set(d.target, (fkIn.get(d.target) ?? 0) + 1);
    }
  }

  for (const e of elements) {
    if (e.group !== 'nodes') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = e.data as any;
    if (d.type !== 'entity' && d.type !== 'jointable') continue;
    const entity = byId.get(d.id)?.data as { name?: string; stereotype?: string; metadata?: Array<{ name: string; value: unknown }> } | undefined;
    const signals: RoleSignals = {
      isJunction: d.type === 'jointable',
      fkInDegree: fkIn.get(d.id) ?? 0,
      fkOutDegree: fkOut.get(d.id) ?? 0,
      remote: isRemote(entity),
    };
    const resolved = resolveElementStyle(
      { name: entity?.name ?? d.label, stereotype: entity?.stereotype, metadata: entity?.metadata },
      signals,
      styles,
      compiledRules,
    );
    if (resolved.styleName) {
      d.styleName = resolved.styleName;
      if (resolved.style?.badge) d.styleBadge = resolved.style.badge;
    }
  }
  return elements;
}
