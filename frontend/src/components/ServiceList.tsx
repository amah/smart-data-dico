import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { getAllPackageHierarchies } from '../services/api';
import { Entity, Package } from '../types';
import CytoscapeGraph from './CytoscapeGraph';
import EntityFlatTable from './EntityFlatTable';
import { Button, EmptyState, Toolbar } from './ui';

type ViewMode = 'table' | 'tree' | 'diagram';

const ServiceList = () => {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('tree');

  useEffect(() => {
    const fetchPackages = async () => {
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
    };

    fetchPackages();
  }, []);

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
