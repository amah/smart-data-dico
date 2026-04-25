import { useCallback, useEffect, useMemo, useState } from 'react';
import { entityApi, packageApi } from '../services/api';
import { Package } from '../types';
import {
  useStereotypeMetadata,
  getMetadataValue,
  setMetadataValue,
} from '../hooks/useStereotypeMetadata';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';
import {
  Button,
  Chip,
  ColumnChooser,
  DataTable,
  EmptyState,
  Field,
  fieldStyle,
  fieldStyleMono,
  Input,
  MetadataField,
  Toolbar,
} from './ui';
import type { ColumnDef } from './ui';

/**
 * PackageFlatTable — global flat view of every package in the project.
 *
 * Phase-6 rewrite: swaps the raw <table> + EditableCell pattern for
 * DataTable + side-panel edit, consistent with the other three flat
 * surfaces (AttributeList / AttributeFlatTable / EntityFlatTable).
 *
 * No bulk-delete action: removing a package cascades the entire folder
 * of entities, which is scary enough to deserve a dedicated flow on
 * the package detail page — not a one-click bar. Selection is
 * therefore not wired on this surface.
 */

const PACKAGE_COL_KEY = 'package-flat-columns-v2';

const PackageFlatTable = () => {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const { allColumns } = useStereotypeMetadata('package');
  const [metaVisible, setMetaVisible] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(PACKAGE_COL_KEY);
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set<string>();
  });
  useEffect(() => {
    localStorage.setItem(PACKAGE_COL_KEY, JSON.stringify([...metaVisible]));
  }, [metaVisible]);

  const [editing, setEditing] = useState<Package | null>(null);

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pkgs: Package[] = await entityApi.getAllPackages();
      setPackages(pkgs);
    } catch {
      setError('Failed to load packages. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPackages(); }, [fetchPackages]);

  // Auto-populate visible metadata columns from the data on first load.
  useEffect(() => {
    if (packages.length > 0 && allColumns.length > 0 && metaVisible.size === 0) {
      const used = new Set<string>();
      for (const pkg of packages) {
        for (const entry of pkg.metadata ?? []) {
          if (allColumns.some(c => c.name === entry.name)) used.add(entry.name);
        }
      }
      if (used.size > 0) setMetaVisible(used);
    }
  }, [packages, allColumns]);

  const activeMetaCols = allColumns.filter(c => metaVisible.has(c.name));

  const filtered = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return packages;
    return packages.filter(p =>
      p.name.toLowerCase().includes(needle) ||
      (p.description ?? '').toLowerCase().includes(needle) ||
      (p.type ?? '').toLowerCase().includes(needle),
    );
  }, [packages, searchTerm]);

  // ──────────────── Save paths ────────────────

  const savePackageField = useCallback(async (
    pkg: Package,
    patch: Partial<Package>,
  ) => {
    await packageApi.updatePackage(pkg.name, [], patch);
    setPackages(prev => prev.map(p => (p.id === pkg.id ? { ...p, ...patch } : p)));
  }, []);

  const savePackageMetadata = useCallback(async (
    pkg: Package,
    metaName: string,
    value: string | number | boolean,
  ) => {
    const nextMetadata = setMetadataValue(pkg.metadata, metaName, value);
    await packageApi.updatePackage(pkg.name, [], { metadata: nextMetadata });
    setPackages(prev => prev.map(p => (p.id === pkg.id ? { ...p, metadata: nextMetadata } : p)));
  }, []);

  // ──────────────── Columns ────────────────

  const columns: ColumnDef<Package>[] = useMemo(() => {
    const std: ColumnDef<Package>[] = [
      {
        key: 'name',
        header: 'Name',
        group: 'standard',
        mono: true,
        sortable: true,
        filterable: true,
        width: 'minmax(180px, 1.4fr)',
        accessor: (p) => p.name,
      },
      {
        key: 'description',
        header: 'Description',
        group: 'standard',
        filterable: true,
        width: 'minmax(260px, 2.2fr)',
        accessor: (p) => p.description ?? '',
        render: (p) => p.description
          ? <span style={{ color: 'var(--text-muted)' }}>{p.description}</span>
          : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>no description</span>,
      },
      {
        key: 'type',
        header: 'Type',
        group: 'standard',
        sortable: true,
        filterable: true,
        width: 120,
        accessor: (p) => p.type ?? '',
        render: (p) => p.type
          ? <Chip tone="neutral">{p.type}</Chip>
          : <span style={{ color: 'var(--text-subtle)' }}>—</span>,
      },
      {
        key: 'entityCount',
        header: 'Entities',
        group: 'standard',
        sortable: true,
        width: 90,
        align: 'center',
        accessor: (p) => p.entities?.length ?? 0,
        render: (p) => {
          const n = p.entities?.length ?? 0;
          return n > 0
            ? <Chip tone="neutral" soft>{n}</Chip>
            : <span style={{ color: 'var(--text-subtle)' }}>—</span>;
        },
      },
      {
        key: 'createdAt',
        header: 'Created',
        group: 'standard',
        sortable: true,
        width: 120,
        accessor: (p) => p.createdAt ?? '',
        render: (p) => p.createdAt
          ? <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              {new Date(p.createdAt).toLocaleDateString()}
            </span>
          : <span style={{ color: 'var(--text-subtle)' }}>—</span>,
      },
      {
        key: 'updatedAt',
        header: 'Updated',
        group: 'standard',
        sortable: true,
        width: 120,
        accessor: (p) => p.updatedAt ?? '',
        render: (p) => p.updatedAt
          ? <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              {new Date(p.updatedAt).toLocaleDateString()}
            </span>
          : <span style={{ color: 'var(--text-subtle)' }}>—</span>,
      },
    ];

    const meta: ColumnDef<Package>[] = activeMetaCols.map((col) => ({
      key: `meta:${col.name}`,
      header: col.label,
      group: 'metadata',
      width: 120,
      accessor: (p) => {
        const v = getMetadataValue(p, col.name);
        return v === undefined ? '' : (typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
      },
      render: (p) => renderMetadataCell(p, col),
    }));

    return [...std, ...meta];
  }, [activeMetaCols]);

  const chooserCols = useMemo(() => columns as unknown as ColumnDef<unknown>[], [columns]);
  const allVisibleKeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of columns) {
      if ((c.group ?? 'standard') === 'standard') set.add(c.key);
    }
    for (const name of metaVisible) set.add(`meta:${name}`);
    return set;
  }, [columns, metaVisible]);

  const handleVisibleChange = useCallback((next: Set<string>) => {
    const nextMeta = new Set<string>();
    next.forEach((key) => {
      if (key.startsWith('meta:')) nextMeta.add(key.slice(5));
    });
    setMetaVisible(nextMeta);
  }, []);

  // ──────────────── Render ────────────────

  return (
    <div className="flex flex-col min-h-0" style={{ flex: 1 }}>
      <Toolbar attached>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--fs-lg)',
            fontWeight: 600,
            color: 'var(--text)',
          }}
        >
          Packages
        </h1>
        <span
          className="mono"
          style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}
        >
          {filtered.length} of {packages.length} · flat view
        </span>
        <Toolbar.Spacer />
        <Input
          icon="search"
          size="sm"
          placeholder="Search packages…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.currentTarget.value)}
          width={240}
        />
        {allColumns.length > 0 && (
          <ColumnChooser
            columns={chooserCols}
            visible={allVisibleKeys}
            onChange={handleVisibleChange}
            label={`Metadata (${activeMetaCols.length})`}
          />
        )}
      </Toolbar>

      {loading ? (
        <EmptyState kind="loading" attached message="Loading packages…" />
      ) : error ? (
        <EmptyState
          kind="error"
          attached
          title="Failed to load packages"
          message={error}
          action={{ label: 'Retry', icon: 'sparkle', onClick: fetchPackages }}
        />
      ) : (
        <DataTable<Package>
          columns={columns}
          rows={filtered}
          getRowKey={(p) => p.id ?? p.name}
          visibleColumns={allVisibleKeys}
          onVisibleColumnsChange={handleVisibleChange}
          onRowClick={(p) => setEditing(p)}
          resizeKey="package-flat"
          stickyHeader
          attached
          emptyMessage={
            <EmptyState
              inline
              kind="empty"
              title="No packages found"
              message={
                searchTerm
                  ? `No packages match "${searchTerm}".`
                  : 'No packages defined yet.'
              }
            />
          }
        />
      )}

      {editing && (
        <PackageSidePanel
          pkg={editing}
          metaColumns={allColumns}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await savePackageField(editing, patch);
          }}
          onMetadataChange={(col, value) => savePackageMetadata(editing, col.name, value)}
        />
      )}
    </div>
  );
};

// ──────────────── Helpers ────────────────

function renderMetadataCell(pkg: Package, col: MetadataColumn) {
  const v = getMetadataValue(pkg, col.name);
  if (v === undefined || v === null || v === '') {
    return <span style={{ color: 'var(--text-subtle)' }}>—</span>;
  }
  if (col.type === 'flag' || col.type === 'boolean') {
    return v
      ? <Chip tone="success" soft>yes</Chip>
      : <Chip tone="neutral">no</Chip>;
  }
  return <span style={{ color: 'var(--text-muted)' }}>{String(v)}</span>;
}

// ──────────────── Side panel ────────────────

interface PackageSidePanelProps {
  pkg: Package;
  metaColumns: MetadataColumn[];
  onClose: () => void;
  onSave: (patch: Partial<Package>) => Promise<void>;
  onMetadataChange: (col: MetadataColumn, value: string | number | boolean) => Promise<void>;
}

const PackageSidePanel = ({
  pkg,
  metaColumns,
  onClose,
  onSave,
  onMetadataChange,
}: PackageSidePanelProps) => {
  const [name, setName] = useState(pkg.name);
  const [description, setDescription] = useState(pkg.description ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setName(pkg.name);
    setDescription(pkg.description ?? '');
    setSavedAt(null);
  }, [pkg.id]);

  const dirty = name !== pkg.name || description !== (pkg.description ?? '');

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await onSave({ name, description });
      setSavedAt(Date.now());
    } catch (err) {
      console.error('Failed to save package:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.25)',
          zIndex: 40,
        }}
      />
      <aside
        role="dialog"
        aria-label="Edit package"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          background: 'var(--bg-raised)',
          borderLeft: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 50,
          animation: 'sddSlide var(--dur-med) ease-out',
        }}
      >
        <style>{`
          @keyframes sddSlide {
            from { transform: translateX(100%); opacity: 0.7; }
            to   { transform: translateX(0);     opacity: 1;   }
          }
        `}</style>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 14px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span
            className="uppercase mono"
            style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', letterSpacing: '0.04em' }}
          >
            edit package
          </span>
          <span
            className="mono"
            style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}
          >
            {pkg.name}
          </span>
          <div style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" icon="close" onClick={onClose} iconOnly aria-label="close" />
        </div>

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <Field label="Name">
            <input
              type="text"
              value={name}
              aria-label="Name"
              onChange={(e) => setName(e.target.value)}
              style={fieldStyleMono}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              aria-label="Description"
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              style={{ ...fieldStyle, minHeight: 72, padding: '6px 8px', fontFamily: 'inherit' }}
            />
          </Field>
          <Field label="Entities" inline>
            <span className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
              {pkg.entities?.length ?? 0}
            </span>
          </Field>

          {metaColumns.length > 0 && (
            <div>
              <div
                className="uppercase"
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--meta-label)',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  marginTop: 8,
                  marginBottom: 6,
                  paddingBottom: 4,
                  borderBottom: '1px dashed var(--meta-border)',
                }}
              >
                Governance metadata
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {metaColumns.map((col) => (
                  <MetadataField
                    key={col.name}
                    column={col}
                    value={getMetadataValue(pkg, col.name)}
                    onChange={(v) => onMetadataChange(col, v)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Button
            size="md"
            variant="primary"
            icon="check"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="md" variant="ghost" onClick={onClose}>Cancel</Button>
          {savedAt && !dirty && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--success)' }}>Saved</span>
          )}
        </div>
      </aside>
    </>
  );
};

export default PackageFlatTable;
