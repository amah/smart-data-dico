/**
 * RelationshipOrmOverview — read-only summary of relationship-scope ORM mapping
 * (`orm.fetch`, `orm.cascade`, `orm.orphanRemoval`, …) for every relationship
 * touching the current entity, shown on the entity ORM tab.
 *
 * Fetch/cascade/lazy are relationship-scoped, so they're authored on each
 * relationship's detail page — this surfaces them in one place next to the
 * entity mapping, with a link to edit each one.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Chip, Icon } from './ui';
import type { Relationship } from '../types';
import { useOrmVocabulary } from '../hooks/useOrmVocabulary';

interface Props {
  relationships: Relationship[];
  service: string;
  entityName: string;
  /** uuid → display name resolver for the relationship ends. */
  nameOf: (uuid: string) => string;
}

export default function RelationshipOrmOverview({ relationships, service, entityName, nameOf }: Props) {
  const vocab = useOrmVocabulary();
  const labelOf = useMemo(() => {
    const m: Record<string, string> = {};
    (vocab?.scopes.relationship ?? []).forEach(d => { m[d.key] = d.label; });
    return (key: string) => m[key] || key.replace(/^orm\./, '');
  }, [vocab]);

  if (!relationships.length) return null;

  return (
    <section style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
        <Icon name="link" size={12} style={{ color: 'var(--text-subtle)' }} />
        <h2 className="uppercase" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', letterSpacing: '0.06em', fontWeight: 600, margin: 0 }}>
          Relationships (ORM)
        </h2>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>fetch · cascade · mappedBy — per relationship</span>
      </header>

      <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {relationships.map(rel => {
          const orm = (rel.metadata || []).filter(m => m.name.startsWith('orm.'));
          const title = `${nameOf(rel.source.entity)} → ${nameOf(rel.target.entity)}`;
          const href = `/packages/${service}/entities/${entityName}/relationships/${rel.uuid}`;
          return (
            <div key={rel.uuid} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{title}</span>
                {rel.description && (
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>{rel.description}</span>
                )}
                <div style={{ flex: 1 }} />
                <Link to={href} style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)' }}>Edit</Link>
              </div>
              {orm.length === 0 ? (
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
                  No ORM mapping — defaults apply. Click Edit to set fetch / cascade / mappedBy.
                </span>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {orm.map(m => (
                    <Chip key={m.name} soft mono>
                      {labelOf(m.name)}: {String(m.value)}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
