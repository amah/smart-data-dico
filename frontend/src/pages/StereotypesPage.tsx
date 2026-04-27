import { useEffect, useState } from 'react';
import { stereotypeApi } from '../services/api';
import type { Stereotype, StereotypeTarget } from '../types';
import StereotypeForm from '../components/StereotypeForm';
import {
  Button,
  Chip,
  EmptyState,
  Modal,
  Toolbar,
} from '../components/ui';

const TARGET_LABELS: Record<StereotypeTarget, string> = {
  entity: 'Entity Stereotypes',
  attribute: 'Attribute Stereotypes',
  package: 'Package Stereotypes',
  relationship: 'Relationship Stereotypes',
  model: 'Model Stereotypes',
};

const VISIBLE_TARGETS: StereotypeTarget[] = ['entity', 'attribute', 'package'];

export default function StereotypesPage() {
  const [stereotypes, setStereotypes] = useState<Stereotype[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const data = await stereotypeApi.getAll();
      setStereotypes(data);
    } catch {
      setError('Failed to load stereotypes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async (data: Stereotype) => {
    try {
      await stereotypeApi.create(data);
      setShowCreate(false);
      fetchData();
    } catch (err) {
      setError(extractError(err) ?? 'Failed to create');
    }
  };

  const handleUpdate = async (data: Stereotype) => {
    try {
      await stereotypeApi.update(data.id, data);
      setEditingId(null);
      fetchData();
    } catch (err) {
      setError(extractError(err) ?? 'Failed to update');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete stereotype "${id}"?`)) return;
    try {
      await stereotypeApi.delete(id);
      fetchData();
    } catch (err) {
      setError(extractError(err) ?? 'Failed to delete');
    }
  };

  const knownDomains = Array.from(
    new Set(stereotypes.map((s) => s.domain?.trim()).filter((d): d is string => !!d)),
  ).sort();

  // Group by domain → then by appliesTo target.
  const groupedByDomain = (() => {
    const buckets = new Map<string, Stereotype[]>();
    for (const s of stereotypes) {
      const key = (s.domain && s.domain.trim()) || 'Uncategorized';
      const arr = buckets.get(key) || [];
      arr.push(s);
      buckets.set(key, arr);
    }
    const sorted = Array.from(buckets.entries()).sort(([a], [b]) => {
      if (a === 'Uncategorized') return 1;
      if (b === 'Uncategorized') return -1;
      return a.localeCompare(b);
    });
    return sorted.map(([domain, items]) => ({
      domain,
      byTarget: VISIBLE_TARGETS
        .map((target) => ({
          target,
          label: TARGET_LABELS[target],
          items: items.filter((s) => s.appliesTo === target),
        }))
        .filter((g) => g.items.length > 0),
    }));
  })();

  if (loading) {
    return <EmptyState kind="loading" message="Loading stereotypes…" />;
  }

  return (
    <div className="flex flex-col min-h-0" style={{ flex: 1, gap: 12 }}>
      <Toolbar>
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--fs-lg)',
              fontWeight: 600,
              color: 'var(--text)',
            }}
          >
            Stereotypes
          </h1>
          <p
            style={{
              margin: 0,
              marginTop: 2,
              fontSize: 'var(--fs-xs)',
              color: 'var(--text-subtle)',
            }}
          >
            Define metadata schemas for packages, entities, and attributes.
          </p>
        </div>
        <Toolbar.Spacer />
        <Button
          size="md"
          variant="primary"
          icon="plus"
          onClick={() => setShowCreate(true)}
        >
          Create Stereotype
        </Button>
      </Toolbar>

      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon="close"
            aria-label="dismiss"
            onClick={() => setError(null)}
          />
        </div>
      )}

      {groupedByDomain.length === 0 && (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}>
          No stereotypes defined yet.
        </p>
      )}

      {groupedByDomain.map(({ domain, byTarget }) => (
        <section
          key={domain}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-subtle)',
            padding: 12,
          }}
        >
          <h2
            className="uppercase"
            style={{
              fontSize: 'var(--fs-xs)',
              fontWeight: 700,
              color: 'var(--text-subtle)',
              letterSpacing: '0.06em',
              margin: 0,
              marginBottom: 10,
            }}
          >
            {domain}
          </h2>

          {byTarget.map(({ target, label, items }) => (
            <div key={target} style={{ marginBottom: 12 }}>
              <h3
                style={{
                  fontSize: 'var(--fs-sm)',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: 6,
                }}
              >
                {label}
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                  gap: 10,
                }}
              >
                {items.map((s) => (
                  <StereotypeCard
                    key={s.id}
                    stereotype={s}
                    onEdit={() => setEditingId(s.id)}
                    onDelete={() => handleDelete(s.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}

      <Modal open={showCreate} title="Create Stereotype" onClose={() => setShowCreate(false)} width={640}>
        <StereotypeForm
          knownDomains={knownDomains}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      </Modal>

      <Modal open={!!editingId} title="Edit Stereotype" onClose={() => setEditingId(null)} width={640}>
        {editingId && (
          <StereotypeForm
            initialValues={stereotypes.find((s) => s.id === editingId)}
            knownDomains={knownDomains}
            onSubmit={handleUpdate}
            onCancel={() => setEditingId(null)}
            isEdit
          />
        )}
      </Modal>
    </div>
  );
}

// ──────────────── Card ────────────────

interface StereotypeCardProps {
  stereotype: Stereotype;
  onEdit: () => void;
  onDelete: () => void;
}

const StereotypeCard = ({ stereotype: s, onEdit, onDelete }: StereotypeCardProps) => (
  <div
    style={{
      padding: 12,
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--fs-md)',
            fontWeight: 600,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {s.name}
        </div>
        <Chip tone="neutral">{s.id}</Chip>
      </div>
      <div style={{ display: 'inline-flex', gap: 4 }}>
        <Button size="sm" variant="ghost" icon="edit" iconOnly aria-label="edit" onClick={onEdit} />
        <Button size="sm" variant="ghost" icon="close" iconOnly aria-label="delete" onClick={onDelete} />
      </div>
    </div>
    {s.description && (
      <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
        {s.description}
      </p>
    )}
    <div>
      <div
        className="uppercase"
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-subtle)',
          letterSpacing: '0.04em',
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        Fields ({s.metadataDefinitions.length})
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {s.metadataDefinitions.map((d) => (
          <Chip key={d.name} tone={d.required ? 'accent' : 'neutral'} soft={!d.required}>
            {d.name}: {d.type}
          </Chip>
        ))}
      </div>
    </div>
  </div>
);

function extractError(err: unknown): string | null {
  if (typeof err === 'object' && err !== null) {
    const e = err as { response?: { data?: { errors?: string[] } } };
    return e.response?.data?.errors?.[0] ?? null;
  }
  return null;
}
