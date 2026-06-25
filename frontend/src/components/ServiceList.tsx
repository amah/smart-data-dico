import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { getAllPackageHierarchies, packageApi } from '../services/api';
import { Entity, Package } from '../types';
import CytoscapeGraph from './CytoscapeGraph';
import EntityFlatTable from './EntityFlatTable';
import { Button, EmptyState, Input, Modal, Toolbar } from './ui';

type ViewMode = 'table' | 'tree' | 'diagram';

const ServiceList = () => {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  // Create-package modal (#blocker: there was no UI to create a package).
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchPackages = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAllPackageHierarchies();
      setPackages(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching package tree:', err);
      setError('Failed to load package hierarchy. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  const openCreate = () => {
    setCreateError(null);
    setNewName('');
    setNewDescription('');
    setShowCreate(true);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setCreateError('Package name is required.');
      return;
    }
    try {
      setCreating(true);
      setCreateError(null);
      await packageApi.createPackage({ name, description: newDescription.trim() || undefined });
      setShowCreate(false);
      await fetchPackages();
      navigate(`/packages/${name}`);
    } catch (err) {
      const e = err as { response?: { data?: { errors?: string[]; message?: string } }; message?: string };
      setCreateError(
        e.response?.data?.errors?.join(' ') ||
        e.response?.data?.message ||
        e.message ||
        'Failed to create package.',
      );
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <EmptyState kind="loading" message="Loading packages…" />;
  }

  if (error) {
    return (
      <EmptyState
        kind="error"
        title="Failed to load packages"
        message={error}
        action={{ label: 'Retry', icon: 'sparkle', onClick: () => window.location.reload() }}
      />
    );
  }

  return (
    <div className="flex flex-col min-h-0" style={{ flex: 1 }}>
      <Toolbar>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--fs-lg)',
            fontWeight: 600,
            color: 'var(--text)',
          }}
        >
          Package Hierarchy
        </h1>
        <Toolbar.Spacer />
        <Button size="sm" variant="primary" icon="plus" onClick={openCreate}>
          New package
        </Button>
        <ViewModeSwitcher value={viewMode} onChange={setViewMode} />
      </Toolbar>

      {viewMode === 'table' ? (
        <EntityFlatTable />
      ) : viewMode === 'tree' ? (
        packages.length === 0 ? (
          <EmptyState
            kind="empty"
            title="No packages"
            message="No packages found. Create a new package to get started."
            action={{ label: 'New package', icon: 'plus', onClick: openCreate }}
          />
        ) : (
          <div
            style={{
              padding: 14,
              background: 'var(--bg-raised)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'auto',
            }}
          >
            <PackageTree packages={packages} />
          </div>
        )
      ) : (
        <div style={{ height: 700 }}>
          <CytoscapeGraph mode="organization" packages={packages} />
        </div>
      )}

      <Modal open={showCreate} title="New package" onClose={() => setShowCreate(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}>
              Name <span style={{ color: 'var(--text-subtle)' }}>(kebab-case)</span>
            </span>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="loan-origination"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}>Description (optional)</span>
            <Input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Loan origination domain"
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
          </label>
          {createError && (
            <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{createError}</span>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

// ──────────────── View mode switcher ────────────────

const MODES: { value: ViewMode; label: string }[] = [
  { value: 'tree', label: 'Tree' },
  { value: 'table', label: 'Table' },
  { value: 'diagram', label: 'Diagram' },
];

interface ViewModeSwitcherProps {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}

const ViewModeSwitcher = ({ value, onChange }: ViewModeSwitcherProps) => (
  <div
    role="group"
    aria-label="View mode"
    style={{
      display: 'inline-flex',
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      overflow: 'hidden',
    }}
  >
    {MODES.map((m, i) => (
      <Button
        key={m.value}
        size="sm"
        variant={value === m.value ? 'primary' : 'ghost'}
        onClick={() => onChange(m.value)}
        style={{
          borderRadius: 0,
          borderLeft: i === 0 ? 0 : '1px solid var(--border)',
        }}
      >
        {m.label}
      </Button>
    ))}
  </div>
);

// ──────────────── Tree ────────────────

interface PackageTreeProps {
  packages: Package[];
}

const PackageTree = ({ packages }: PackageTreeProps) => (
  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
    {packages.map((pkg) => (
      <PackageNode key={pkg.id} pkg={pkg} level={0} />
    ))}
  </ul>
);

interface PackageNodeProps {
  pkg: Package;
  level: number;
}

const PackageNode = ({ pkg, level }: PackageNodeProps) => (
  <li
    style={{
      marginBottom: 8,
      paddingLeft: level * 16,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        className="mono"
        style={{ fontWeight: 600, color: 'var(--text)' }}
      >
        {pkg.name}
      </span>
      {pkg.description && (
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
          {pkg.description}
        </span>
      )}
      <Link
        to={`/packages/${pkg.id}`}
        style={{ marginLeft: 4 }}
      >
        <Button size="sm" variant="ghost">Details</Button>
      </Link>
    </div>

    {pkg.entities && pkg.entities.length > 0 && (
      <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0 24px' }}>
        {pkg.entities.map((entity: Entity) => (
          <li
            key={entity.uuid}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '2px 0',
            }}
          >
            <Link
              to={`/packages/${pkg.name}/entities/${entity.name}`}
              className="mono"
              style={{ color: 'var(--accent)', textDecoration: 'none' }}
            >
              {entity.name}
            </Link>
            {entity.description && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
                {entity.description}
              </span>
            )}
          </li>
        ))}
      </ul>
    )}

    {pkg.subPackages && pkg.subPackages.length > 0 && (
      <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0 0' }}>
        {pkg.subPackages.map((sub) => (
          <PackageNode key={sub.id} pkg={sub} level={level + 1} />
        ))}
      </ul>
    )}
  </li>
);

export default ServiceList;
