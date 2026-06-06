/**
 * JpaInheritancePanel — shows an entity's JPA inheritance tree, derived from the
 * reserved `jpa.extends` metadata: the ancestor chain (this → … → root) and the
 * direct subclasses. Read-only; no model concept beyond the metadata reference.
 */
import { Link } from 'react-router-dom';
import { Chip, Icon } from './ui';
import type { Entity, MetadataEntry, MetadataValue } from '../types';

export interface EntityRef { entity: Entity; service: string; }

const meta = (md: MetadataEntry[] | undefined, key: string): MetadataValue | undefined =>
  (md || []).find(m => m.name === key)?.value;
const extendsRef = (e: Entity): string => {
  const v = meta(e.metadata, 'jpa.extends');
  return v === undefined || v === null ? '' : String(v);
};

export default function JpaInheritancePanel({ current, all }: { current: Entity; all: EntityRef[] }) {
  const byUuid = new Map(all.map(r => [r.entity.uuid, r]));
  const byName = new Map(all.map(r => [r.entity.name, r]));
  const resolve = (ref: string): EntityRef | undefined => byUuid.get(ref) || byName.get(ref);

  // Ancestor chain (current → parent → … → root), guarding against cycles.
  const ancestors: EntityRef[] = [];
  const seen = new Set<string>([current.uuid || current.name]);
  let cur: Entity | undefined = current;
  while (cur) {
    const ref = extendsRef(cur);
    if (!ref) break;
    const p = resolve(ref);
    if (!p) break;
    const id = p.entity.uuid || p.entity.name;
    if (seen.has(id)) break; // cycle — validator flags this separately
    seen.add(id);
    ancestors.push(p);
    cur = p.entity;
  }

  // Direct subclasses (entities whose jpa.extends resolves to current).
  const curIds = new Set([current.uuid, current.name].filter(Boolean));
  const children = all.filter(r => {
    const ref = extendsRef(r.entity);
    if (!ref) return false;
    const target = resolve(ref);
    return target ? curIds.has(target.entity.uuid) || curIds.has(target.entity.name) : false;
  });

  if (ancestors.length === 0 && children.length === 0) return null; // not part of any hierarchy

  const link = (r: EntityRef) => (
    <Link key={r.entity.uuid || r.entity.name} to={`/packages/${r.service}/entities/${r.entity.name}`} style={{ textDecoration: 'none' }}>
      <Chip soft>{r.entity.name}</Chip>
    </Link>
  );

  return (
    <section style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
        <Icon name="link" size={12} style={{ color: 'var(--text-subtle)' }} />
        <h2 className="uppercase" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', letterSpacing: '0.06em', fontWeight: 600, margin: 0 }}>
          JPA inheritance
        </h2>
      </header>
      <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ancestors.length > 0 && (
          <div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 6 }}>Supertypes (root last)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Chip mono soft>{current.name}</Chip>
              {ancestors.map(a => (<span key={a.entity.uuid || a.entity.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--text-subtle)' }}>▸</span>{link(a)}
              </span>))}
            </div>
          </div>
        )}
        {children.length > 0 && (
          <div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginBottom: 6 }}>Subclasses</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children.map(link)}</div>
          </div>
        )}
      </div>
    </section>
  );
}
