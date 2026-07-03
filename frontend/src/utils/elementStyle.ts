/**
 * Element Style resolver (#element-style). Computes, once per element, which named
 * style applies — by precedence: explicit `system.style` override → a matching
 * `styleRule` → a detected role → the element's stereotype (same-named style) →
 * none. The resolved name becomes a `styleName` data field the Cytoscape
 * stylesheet keys off, so styling scales to 1000+ nodes. See docs/element-style.md.
 */

export interface ElementStyle {
  name: string;
  label?: string;
  fill?: string;
  border?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  shape?: string;
  opacity?: number;
  textColor?: string;
  badge?: string;
  emphasis?: boolean;
  default?: boolean;   // applied to any element nothing else styles (at most one)
}

export interface StyleRule {
  match: 'stereotype' | 'role' | 'entityName' | 'physicalTableName';
  pattern: string;
  regex?: boolean;
  style: string;
}

/** Roles inferred with zero tagging from graph/structure signals. */
export type DetectedRole = 'junction' | 'reference' | 'remote-ref';

/** Structural signals used to detect a role (computed by the element builders). */
export interface RoleSignals {
  isJunction?: boolean;   // relation/link table (already `type:'jointable'`)
  fkInDegree?: number;    // number of FKs pointing AT this element
  fkOutDegree?: number;   // number of FKs this element declares
  remote?: boolean;       // cross-package / cross-repo target
}

interface MetaEntry { name: string; value: unknown }
export interface StyleableElement { name?: string; stereotype?: string; metadata?: MetaEntry[] }

function metaValue(metadata: MetaEntry[] | undefined, key: string): string | undefined {
  const hit = metadata?.find((m) => m.name === key);
  return hit == null ? undefined : String(hit.value);
}

function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`, 'i');
}

export interface CompiledStyleRule { match: StyleRule['match']; re: RegExp; style: string }

export function compileStyleRules(rules: StyleRule[] | undefined): CompiledStyleRule[] {
  const out: CompiledStyleRule[] = [];
  for (const r of rules ?? []) {
    if (!r?.pattern || !r.match || !r.style) continue;
    try { out.push({ match: r.match, re: r.regex ? new RegExp(r.pattern, 'i') : globToRegExp(r.pattern), style: r.style }); }
    catch { /* skip invalid regex */ }
  }
  return out;
}

/** Infer a role from structural signals (remote wins, then junction, then FK-target-only). */
export function detectRole(sig: RoleSignals | undefined): DetectedRole | undefined {
  if (!sig) return undefined;
  if (sig.remote) return 'remote-ref';
  if (sig.isJunction) return 'junction';
  if ((sig.fkInDegree ?? 0) > 0 && (sig.fkOutDegree ?? 0) === 0) return 'reference';
  return undefined;
}

export interface ResolvedElementStyle {
  styleName?: string;         // the winning style's name, if any
  style?: ElementStyle;       // the style object
  role?: DetectedRole;        // the detected role (for badges/legend), independent of styling
}

/**
 * Resolve the effective style for an element. `styles`/`rules` come from the
 * project config (compile `rules` once with {@link compileStyleRules} for a batch).
 */
export function resolveElementStyle(
  element: StyleableElement,
  signals: RoleSignals | undefined,
  styles: ElementStyle[],
  compiledRules: CompiledStyleRule[],
): ResolvedElementStyle {
  const byName = new Map(styles.map((s) => [s.name, s] as const));
  const role = detectRole(signals);
  const pick = (name?: string): ResolvedElementStyle | null =>
    name && byName.has(name) ? { styleName: name, style: byName.get(name), role } : null;

  // 1. explicit override
  const override = pick(metaValue(element.metadata, 'system.style'));
  if (override) return override;

  // 2. style rules
  const targets: Record<StyleRule['match'], string | undefined> = {
    stereotype: element.stereotype,
    role,
    entityName: element.name,
    physicalTableName: metaValue(element.metadata, 'physical.tableName'),
  };
  for (const r of compiledRules) {
    const t = targets[r.match];
    if (t && r.re.test(t)) { const hit = pick(r.style); if (hit) return hit; }
  }

  // 3. detected role → same-named style; 4. stereotype → same-named style
  const roleOrStereotype = pick(role) ?? pick(element.stereotype);
  if (roleOrStereotype) return roleOrStereotype;
  // 5. the designated default style — applied to anything nothing else styled.
  const def = styles.find((s) => s.default);
  return def ? { styleName: def.name, style: def, role } : { role };
}
