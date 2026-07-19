import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useHighlightOnArrival } from '../hooks/useHighlightOnArrival';
import { packageApi, servicesApi, stereotypeApi, configApi, type ElementStyle } from '../services/api';
import type { Package, Entity, Stereotype, Breadcrumb } from '../types';
import PackageForm from '../components/PackageForm';
import DiagramViewer from '../components/CytoscapeGraph/DiagramViewer';
import Breadcrumbs from '../components/Breadcrumbs';
import { Button, Chip, PageHeader, Menu, Icon } from '../components/ui';
import { StyleSwatch } from './ElementStylesPage';
import { useRecordRecentPackage } from '../hooks/useRecentPackages';
import { useStoredState } from '../hooks/useStoredState';

type PackageViewMode = 'page' | 'graph';
const isPackageViewMode = (raw: string): raw is PackageViewMode =>
  raw === 'page' || raw === 'graph';

interface PackageDetailPageProps {
  packagePath: string[];
}

export default function PackageDetailPage({ packagePath }: PackageDetailPageProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Sticky List/Diagram choice: an explicit ?view= URL param wins (deep
  // links stay deterministic), otherwise the last choice, default Diagram.
  const [storedView, setStoredView] = useStoredState('sdd-package-view', 'graph', isPackageViewMode);
  const urlView = searchParams.get('view');
  const viewMode: PackageViewMode = urlView && isPackageViewMode(urlView) ? urlView : storedView;
  const selectView = (v: PackageViewMode) => {
    setStoredView(v);
    const next = new URLSearchParams(searchParams);
    next.set('view', v);
    setSearchParams(next);
  };
  const [pkg, setPkg] = useState<Package | null>(null);
  // Scroll container for the entity list, so an AI-applied change can
  // scroll-to + flash the changed entity row on arrival (#191 §B).
  const entityListRef = useRef<HTMLDivElement>(null);
  // Flash the row named by ?highlight= once entities have rendered.
  useHighlightOnArrival(entityListRef, pkg?.entities);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateSub, setShowCreateSub] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showBatchCreate, setShowBatchCreate] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchCreating, setBatchCreating] = useState(false);
  const [stereotypes, setStereotypes] = useState<Stereotype[]>([]);
  const [entityFilter, setEntityFilter] = useState('');
  // Bulk style application (#element-style): select entities → apply a style to all.
  // Keys are "<packagePath>::<entityName>" so selection can span sub-packages.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Collapsed sub-package group paths in the entity table (empty = all expanded).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [elementStyles, setElementStyles] = useState<ElementStyle[]>([]);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [entitySort, setEntitySort] = useState<{ key: 'name' | 'description' | 'attributes'; dir: 'asc' | 'desc' }>({
    key: 'name',
    dir: 'asc',
  });

  // Track package visits for the "Recently viewed" strip on Home (#102 P3).
  useRecordRecentPackage(packagePath[0]);

  // All package names, for the per-entity "Move to package" picker (#move-entity).
  const [allPackages, setAllPackages] = useState<string[]>([]);

  useEffect(() => {
    stereotypeApi.getAll('entity').then(setStereotypes).catch(() => {});
    configApi.getElementStyles().then(setElementStyles).catch(() => {});
    servicesApi.getAllServices().then((r) => setAllPackages(r?.data ?? [])).catch(() => {});
  }, []);

  const rootPackage = packagePath[0];
  const subPath = packagePath.slice(1);
  const packageUrl = `/packages/${packagePath.join('/')}`;

  useEffect(() => {
    if (packagePath.length === 0) return;

    const fetchPackage = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await packageApi.getPackageByPath(rootPackage, subPath);
        setPkg(data);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load package');
      } finally {
        setLoading(false);
      }
    };

    fetchPackage();
    setSelected(new Set()); // reset selection when navigating between packages
  }, [rootPackage, subPath.join('/')]);

  // Selection is keyed by "<packagePath>::<entityName>" so a bulk action can span
  // this package AND its sub-packages (each descendant carries its own package path).
  const entityKey = (pkg: string, name: string) => `${pkg}::${name}`;
  const parseKey = (key: string): { pkg: string; name: string } => {
    const i = key.lastIndexOf('::');
    return { pkg: key.slice(0, i), name: key.slice(i + 2) };
  };
  const toggleSelect = (key: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const setSelectKeys = (keys: string[], checked: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    for (const k of keys) { if (checked) next.add(k); else next.delete(k); }
    return next;
  });

  // Run an async op over every selected (package, entity), tolerating per-item
  // failures, then refresh once. Shared by the bulk style/hide handlers so both
  // operate across descendants living in sub-packages.
  const runBulk = async (
    verbLabel: (ok: number, total: number, failed: string[]) => string,
    op: (pkg: string, name: string) => Promise<unknown>,
  ) => {
    if (selected.size === 0 || bulkApplying) return;
    (document.activeElement as HTMLElement | null)?.blur(); // close any open dropdown
    setBulkApplying(true);
    setBulkMsg(null);
    const keys = [...selected];
    const failed: string[] = [];
    for (const key of keys) {
      const { pkg, name } = parseKey(key);
      try { await op(pkg, name); } catch { failed.push(name); }
    }
    try {
      const updated = await packageApi.getPackageByPath(rootPackage, subPath);
      setPkg(updated);
    } catch { /* keep current view */ }
    setBulkMsg(verbLabel(keys.length - failed.length, keys.length, failed));
    setSelected(new Set());
    setBulkApplying(false);
    setTimeout(() => setBulkMsg(null), 5000);
  };

  // Apply a style to every selected entity. `style` empty clears the override.
  const applyBulkStyle = (style: string) => {
    const label = style ? `"${style}"` : 'Default (cleared)';
    return runBulk(
      (ok, total, failed) => failed.length
        ? `Applied ${label} to ${ok}/${total} — failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`
        : `Applied ${label} to ${ok} ${ok === 1 ? 'entity' : 'entities'}.`,
      (pkg, name) => servicesApi.setEntityStyle(pkg, name, style || null),
    );
  };

  // Hide or unhide every selected entity (toggles the reserved system.hidden flag).
  const applyBulkHidden = (hidden: boolean) => {
    const verb = hidden ? 'Hid' : 'Unhid';
    return runBulk(
      (ok, total, failed) => failed.length
        ? `${verb} ${ok}/${total} — failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`
        : `${verb} ${ok} ${ok === 1 ? 'entity' : 'entities'}.`,
      (pkg, name) => servicesApi.setEntityHidden(pkg, name, hidden),
    );
  };

  // Move a single entity from its own package to another (#move-entity). Keeps its
  // UUID, so relationships/cases/diagrams that reference it survive.
  const moveEntity = async (pkg: string, name: string, targetPackage: string) => {
    if (bulkApplying) return;
    setBulkApplying(true);
    setBulkMsg(null);
    try {
      await servicesApi.moveEntity(pkg, name, targetPackage);
      const updated = await packageApi.getPackageByPath(rootPackage, subPath);
      setPkg(updated);
      setBulkMsg(`Moved "${name}" to ${targetPackage}.`);
    } catch (err: any) {
      const detail = err?.response?.data?.errors?.[0] || err?.response?.data?.message || err?.message || 'unknown error';
      setBulkMsg(`Failed to move "${name}": ${detail}`);
    }
    setBulkApplying(false);
    setTimeout(() => setBulkMsg(null), 5000);
  };

  const handleCreateSubPackage = async (data: { name: string; description: string; type: string }) => {
    try {
      await packageApi.createSubPackage(rootPackage, [...subPath, data.name], {
        name: data.name,
        description: data.description,
        type: data.type,
      });
      setShowCreateSub(false);
      // Refresh
      const updated = await packageApi.getPackageByPath(rootPackage, subPath);
      setPkg(updated);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create sub-package');
    }
  };

  const handleUpdatePackage = async (data: { name: string; description: string; type: string }) => {
    try {
      await packageApi.updatePackage(rootPackage, subPath, {
        description: data.description,
        type: data.type,
      });
      setShowEdit(false);
      const updated = await packageApi.getPackageByPath(rootPackage, subPath);
      setPkg(updated);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update package');
    }
  };

  const handleDeletePackage = async () => {
    try {
      await packageApi.deletePackage(rootPackage, subPath);
      // Navigate to parent
      if (subPath.length > 0) {
        navigate(`/packages/${[rootPackage, ...subPath.slice(0, -1)].join('/')}`);
      } else {
        navigate('/packages');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete package');
      setShowDeleteConfirm(false);
    }
  };

  const handleBatchCreate = async () => {
    if (!batchText.trim()) return;
    setBatchCreating(true);
    try {
      const lines = batchText.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const parts = line.split('|').map(s => s.trim());
        const name = parts[0];
        if (!name) continue;
        const description = parts[1] || '';
        const stereotype = parts[2] || undefined;

        const entity: Entity = {
          uuid: crypto.randomUUID(),
          name,
          description,
          stereotype: stereotype && stereotypes.some(s => s.id === stereotype) ? stereotype : undefined,
          attributes: [],
        };
        await servicesApi.createEntity(rootPackage, entity);
      }
      setShowBatchCreate(false);
      setBatchText('');
      // Refresh
      const updated = await packageApi.getPackageByPath(rootPackage, subPath);
      setPkg(updated);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create entities');
    } finally {
      setBatchCreating(false);
    }
  };

  if (packagePath.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Packages</h1>
        <p className="text-base-content/60 mt-2">Select a package from the sidebar to view details.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!pkg) return null;

  const entityCount = pkg.entities?.length ?? 0;
  const subPackageCount = pkg.subPackages?.length ?? 0;
  const relationshipCount = pkg.relationships?.length ?? 0;

  const headerCrumbs: Breadcrumb[] = [
    { label: 'Home', path: '/' },
    { label: 'Packages', path: '/packages' },
    ...packagePath.map((seg, i) => ({
      label: seg,
      path: '/packages/' + packagePath.slice(0, i + 1).join('/'),
    })),
  ];

  return (
    // In graph view the page becomes a fill-height flex column so the
    // diagram canvas takes all space left under the header.
    <div
      className={`px-4 pb-4 ${viewMode === 'graph' ? 'flex flex-col flex-1 min-h-0 gap-4' : 'space-y-4'}`}
      style={{ paddingTop: 5 }}
    >
      <PageHeader
        breadcrumb={<Breadcrumbs items={headerCrumbs} />}
        meta={pkg.type ? <Chip tone="meta" soft>{pkg.type}</Chip> : undefined}
        description={pkg.description}
        tabs={
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 2,
              background: 'var(--bg-raised)',
              gap: 2,
            }}
          >
            {(['page', 'graph'] as const).map((v) => {
              const active = viewMode === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => selectView(v)}
                  style={{
                    padding: '2px 10px',
                    fontSize: 'var(--fs-sm)',
                    borderRadius: 4,
                    border: 'none',
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-subtle)',
                    cursor: 'pointer',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {v === 'page' ? 'Page' : 'Diagram'}
                </button>
              );
            })}
          </div>
        }
        actions={
          <>
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setShowEdit(true)}>Edit</Button>
            <Button size="sm" variant="danger" icon="close" onClick={() => setShowDeleteConfirm(true)}>Delete</Button>
          </>
        }
      />

      {viewMode === 'graph' ? (
        <DiagramViewer service={rootPackage} mode="service" />
      ) : (
      <>
      {/* Stats */}
      <div className="stats stats-horizontal shadow w-full">
        <div className="stat">
          <div className="stat-title">Entities</div>
          <div className="stat-value text-lg">{entityCount}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Sub-packages</div>
          <div className="stat-value text-lg">{subPackageCount}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Relationships</div>
          <div className="stat-value text-lg">{relationshipCount}</div>
        </div>
      </div>

      {/* Entities */}
      <div className="card bg-base-200">
        <div className="card-body">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="card-title text-lg">Entities</h2>
            <div className="flex gap-2 items-center">
              {entityCount > 0 && (
                <input
                  type="text"
                  placeholder="Filter by name or description..."
                  className="input input-sm input-bordered w-60"
                  value={entityFilter}
                  onChange={(e) => setEntityFilter(e.target.value)}
                />
              )}
              <button className="btn btn-sm btn-outline" onClick={() => setShowBatchCreate(true)}>
                Batch Add
              </button>
              <Link to={`${packageUrl}/entities/create`} className="btn btn-sm btn-primary">
                Add Entity
              </Link>
              <Link to="/cases/create" className="btn btn-sm btn-primary">
                Add Case
              </Link>
            </div>
          </div>
          {(entityCount === 0 && subPackageCount === 0) ? (
            <p className="text-base-content/50">No entities in this package.</p>
          ) : (() => {
            const INDENT = 18; // px per tree depth
            const q = entityFilter.trim().toLowerCase();
            const currentPkgPath = packagePath.join('/');
            const dir = entitySort.dir === 'asc' ? 1 : -1;
            const matchesQ = (e: Entity) => !q || e.name.toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q);
            const sortEntities = (list: Entity[]) => [...list].sort((a, b) => {
              if (entitySort.key === 'attributes') return ((a.attributes?.length ?? 0) - (b.attributes?.length ?? 0)) * dir;
              const av = (entitySort.key === 'description' ? (a.description || '') : a.name).toLowerCase();
              const bv = (entitySort.key === 'description' ? (b.description || '') : b.name).toLowerCase();
              return av.localeCompare(bv) * dir;
            });
            const toggleSort = (key: 'name' | 'description' | 'attributes') => setEntitySort(s =>
              s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
            );
            const arrow = (key: string) => entitySort.key === key ? (entitySort.dir === 'asc' ? ' ▲' : ' ▼') : '';
            const styleOf = (e: Entity) => e.metadata?.find((m) => m.name === 'system.style')?.value as string | undefined;
            const hiddenOf = (e: Entity) => e.metadata?.find((m) => m.name === 'system.hidden')?.value === 'true';
            const toggleGroup = (path: string) => setCollapsedGroups((prev) => {
              const next = new Set(prev);
              if (next.has(path)) next.delete(path); else next.add(path);
              return next;
            });

            // All matching entity keys under a subtree — powers a group's select-all.
            const collectKeys = (p: Package, pkgPath: string): string[] => {
              const out: string[] = [];
              for (const e of (p.entities ?? [])) if (matchesQ(e)) out.push(entityKey(pkgPath, e.name));
              for (const s of (p.subPackages ?? [])) out.push(...collectKeys(s, `${pkgPath}/${s.name}`));
              return out;
            };

            // Flatten parent entities + sub-package groups + descendant entities into
            // one ordered row list. Groups are expandable; entities indent by depth.
            type Row =
              | { kind: 'entity'; entity: Entity; pkg: string; url: string; depth: number; key: string }
              | { kind: 'group'; pkg: string; name: string; url: string; depth: number; entityCount: number; subCount: number; descKeys: string[]; collapsed: boolean };
            const rows: Row[] = [];
            for (const e of sortEntities((pkg.entities ?? []).filter(matchesQ))) {
              rows.push({ kind: 'entity', entity: e, pkg: currentPkgPath, url: packageUrl, depth: 0, key: entityKey(currentPkgPath, e.name) });
            }
            const walkSub = (sub: Package, depth: number, pkgPath: string, url: string) => {
              const descKeys = collectKeys(sub, pkgPath);
              if (q && descKeys.length === 0) return; // filtering: skip empty subtrees
              const collapsed = collapsedGroups.has(pkgPath);
              rows.push({ kind: 'group', pkg: pkgPath, name: sub.name, url, depth, entityCount: sub.entities?.length ?? 0, subCount: sub.subPackages?.length ?? 0, descKeys, collapsed });
              if (collapsed) return;
              for (const e of sortEntities((sub.entities ?? []).filter(matchesQ))) {
                rows.push({ kind: 'entity', entity: e, pkg: pkgPath, url, depth: depth + 1, key: entityKey(pkgPath, e.name) });
              }
              for (const cs of (sub.subPackages ?? [])) walkSub(cs, depth + 1, `${pkgPath}/${cs.name}`, `${url}/${cs.name}`);
            };
            for (const sub of (pkg.subPackages ?? [])) walkSub(sub, 0, `${currentPkgPath}/${sub.name}`, `${packageUrl}/${sub.name}`);

            const allKeys = rows.filter((r): r is Extract<Row, { kind: 'entity' }> => r.kind === 'entity').map((r) => r.key);
            const allChecked = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
            const someChecked = allKeys.some((k) => selected.has(k));
            const moveTargetsFor = (pkgPath: string) => allPackages.filter((p) => p !== pkgPath);
            return (
              <>
                {/* Bulk style bar — appears once entities are selected. */}
                {selected.size > 0 && (
                  <div
                    role="region"
                    aria-label="Bulk entity actions"
                    className="sticky top-0 z-30 flex flex-wrap items-center gap-2 mb-2 p-2 rounded-lg bg-base-200 border border-base-300 shadow-md"
                  >
                    <span className="text-sm font-medium">{selected.size} selected</span>
                    {/* Pick a style → applies to all selected immediately (no Apply button).
                        Each option is a visual excerpt of the style, not just its name. */}
                    <div className="dropdown">
                      <label tabIndex={0} className={`btn btn-sm btn-primary ${bulkApplying ? 'btn-disabled' : ''}`}>
                        {bulkApplying ? 'Applying…' : 'Set style ▾'}
                      </label>
                      <ul tabIndex={0} className="dropdown-content menu z-50 mt-1 p-1 shadow-lg bg-base-100 rounded-box w-64 max-h-80 overflow-y-auto flex-nowrap">
                        <li>
                          <button className="flex items-center gap-2" onClick={() => applyBulkStyle('')}>
                            <span className="inline-flex items-center justify-center w-11 h-7 shrink-0 rounded border border-dashed border-base-300 text-base-content/40 text-xs">none</span>
                            <span>Default (clear override)</span>
                          </button>
                        </li>
                        {elementStyles.map((s) => (
                          <li key={s.name}>
                            <button className="flex items-center gap-2" onClick={() => applyBulkStyle(s.name)}>
                              <StyleSwatch style={s} />
                              <span className="truncate">{s.label || s.name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {/* Bulk hide / unhide — toggles the reserved system.hidden flag on all selected. */}
                    <span className="w-px h-5 bg-base-300" aria-hidden />
                    <Button size="sm" variant="secondary" icon="eyeOff" onClick={() => applyBulkHidden(true)} disabled={bulkApplying}>
                      Hide
                    </Button>
                    <Button size="sm" variant="secondary" icon="eye" onClick={() => applyBulkHidden(false)} disabled={bulkApplying}>
                      Unhide
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={bulkApplying}>
                      Clear
                    </Button>
                  </div>
                )}
                {bulkMsg && <div className="text-sm mb-2 text-base-content/70">{bulkMsg}</div>}
                <div className="overflow-x-auto" ref={entityListRef}>
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th className="w-8">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            aria-label="Select all entities"
                            checked={allChecked}
                            ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                            onChange={(e) => setSelectKeys(allKeys, e.target.checked)}
                          />
                        </th>
                        <th className="cursor-pointer select-none" onClick={() => toggleSort('name')}>Name{arrow('name')}</th>
                        <th className="cursor-pointer select-none" onClick={() => toggleSort('description')}>Description{arrow('description')}</th>
                        <th className="cursor-pointer select-none" onClick={() => toggleSort('attributes')}>Attributes{arrow('attributes')}</th>
                        <th>Style</th>
                        <th>Hidden</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => r.kind === 'group' ? (
                        <tr key={`g-${r.pkg}`} className="hover">
                          <td>
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm"
                              aria-label={`Select all entities in ${r.name}`}
                              checked={r.descKeys.length > 0 && r.descKeys.every((k) => selected.has(k))}
                              ref={(el) => { if (el) el.indeterminate = r.descKeys.some((k) => selected.has(k)) && !r.descKeys.every((k) => selected.has(k)); }}
                              onChange={(e) => setSelectKeys(r.descKeys, e.target.checked)}
                            />
                          </td>
                          <td colSpan={6}>
                            <div className="flex items-center gap-1" style={{ paddingLeft: r.depth * INDENT }}>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs btn-square"
                                aria-label={r.collapsed ? `Expand ${r.name}` : `Collapse ${r.name}`}
                                aria-expanded={!r.collapsed}
                                onClick={() => toggleGroup(r.pkg)}
                              >
                                <Icon name={r.collapsed ? 'chevronR' : 'chevron'} />
                              </button>
                              <Icon name="folder" className="opacity-60" />
                              <Link to={r.url} className="link link-primary font-semibold">{r.name}</Link>
                              <span className="text-xs opacity-50">
                                {r.entityCount} {r.entityCount === 1 ? 'entity' : 'entities'}{r.subCount ? ` · ${r.subCount} sub` : ''}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={`e-${r.key}`} className={`hover ${hiddenOf(r.entity) ? 'opacity-50' : ''}`} data-ttrowkey={r.entity.name}>
                          <td>
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm"
                              aria-label={`Select ${r.entity.name}`}
                              checked={selected.has(r.key)}
                              onChange={() => toggleSelect(r.key)}
                            />
                          </td>
                          <td>
                            <div style={{ paddingLeft: r.depth * INDENT }}>
                              <Link to={`${r.url}/entities/${r.entity.name}`} className="link link-primary font-mono">
                                {r.entity.name}
                              </Link>
                            </div>
                          </td>
                          <td className="text-sm text-base-content/70 max-w-xs truncate">
                            {r.entity.description || '-'}
                          </td>
                          <td>{r.entity.attributes?.length ?? 0}</td>
                          <td>
                            {styleOf(r.entity)
                              ? <Chip tone="meta" soft>{styleOf(r.entity)}</Chip>
                              : <span className="text-base-content/40">—</span>}
                          </td>
                          <td>
                            {hiddenOf(r.entity)
                              ? <Chip tone="meta" soft>hidden</Chip>
                              : <span className="text-base-content/40">—</span>}
                          </td>
                          <td className="text-right">
                            <Menu
                              align="end"
                              width={220}
                              trigger={({ toggle }) => (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  icon="moreV"
                                  iconOnly
                                  aria-label={`Actions for ${r.entity.name}`}
                                  onClick={toggle}
                                />
                              )}
                            >
                              {({ close }) => (
                                <div className="p-1">
                                  <div className="px-2 py-1 text-xs font-semibold opacity-70">Move to package</div>
                                  {moveTargetsFor(r.pkg).length === 0 ? (
                                    <div className="px-2 py-1 text-xs opacity-50">No other packages</div>
                                  ) : (
                                    moveTargetsFor(r.pkg).map((p) => (
                                      <button
                                        key={p}
                                        className="block w-full text-left px-2 py-1 text-sm rounded hover:bg-base-200 font-mono"
                                        disabled={bulkApplying}
                                        onClick={() => { close(); moveEntity(r.pkg, r.entity.name, p); }}
                                      >
                                        {p}
                                      </button>
                                    ))
                                  )}
                                </div>
                              )}
                            </Menu>
                          </td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={7} className="text-center text-base-content/50 py-4">
                            No entities match "{entityFilter}"
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Sub-packages */}
      <div className="card bg-base-200">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 className="card-title text-lg">Sub-packages</h2>
            <button className="btn btn-sm btn-primary" onClick={() => setShowCreateSub(true)}>
              Add Sub-package
            </button>
          </div>
          {subPackageCount === 0 ? (
            <p className="text-base-content/50">No sub-packages.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {pkg.subPackages!.map((sub) => (
                <Link
                  key={sub.id}
                  to={`${packageUrl}/${sub.name}`}
                  className="card bg-base-100 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="card-body p-4">
                    <h3 className="font-bold">{sub.name}</h3>
                    {sub.description && (
                      <p className="text-sm text-base-content/70 line-clamp-2">{sub.description}</p>
                    )}
                    <div className="flex gap-2 text-xs opacity-60 mt-1">
                      <span>{sub.entities?.length ?? 0} entities</span>
                      <span>{sub.subPackages?.length ?? 0} sub-packages</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Metadata */}
      {pkg.metadata && pkg.metadata.length > 0 && (
        <div className="card bg-base-200">
          <div className="card-body">
            <h2 className="card-title text-lg">Metadata</h2>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {pkg.metadata.map((entry, i) => (
                    <tr key={i}>
                      <td className="font-mono">{entry.name}</td>
                      <td>{String(entry.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      </>
      )}

      {/* Create Sub-package Modal */}
      {showCreateSub && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Create Sub-package</h3>
            <div className="mt-4">
              <PackageForm
                onSubmit={handleCreateSubPackage}
                onCancel={() => setShowCreateSub(false)}
              />
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowCreateSub(false)}>close</button>
          </form>
        </dialog>
      )}

      {/* Edit Package Modal */}
      {showEdit && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Edit Package</h3>
            <div className="mt-4">
              <PackageForm
                initialValues={{ name: pkg.name, description: pkg.description, type: pkg.type as string }}
                onSubmit={handleUpdatePackage}
                onCancel={() => setShowEdit(false)}
                isEdit
              />
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowEdit(false)}>close</button>
          </form>
        </dialog>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Delete Package</h3>
            <p className="py-4">
              Are you sure you want to delete <strong>{pkg.name}</strong>? This cannot be undone.
            </p>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="btn btn-error" onClick={handleDeletePackage}>Delete</button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowDeleteConfirm(false)}>close</button>
          </form>
        </dialog>
      )}

      {/* Batch Entity Creation Modal */}
      {showBatchCreate && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <h3 className="font-bold text-lg">Batch Create Entities</h3>
            <p className="text-sm text-base-content/70 mt-1">
              One entity per line. Format: <code className="text-xs">Name | Description | stereotype-id</code>
            </p>
            <textarea
              className="textarea textarea-bordered w-full h-48 mt-3 font-mono text-sm"
              placeholder={`Customer | Main customer entity | aggregate-root\nProduct | Product catalog item | aggregate-root\nCategory | Product category | reference-data\nOrder | Customer order | aggregate-root\nOrderLine | Line item in an order | value-object\nPayment | Payment transaction | event`}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              disabled={batchCreating}
            />
            {stereotypes.length > 0 && (
              <div className="text-xs text-base-content/50 mt-1">
                Available stereotypes: {stereotypes.map(s => s.id).join(', ')}
              </div>
            )}
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => { setShowBatchCreate(false); setBatchText(''); }} disabled={batchCreating}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleBatchCreate} disabled={batchCreating || !batchText.trim()}>
                {batchCreating ? (
                  <><span className="loading loading-spinner loading-sm"></span> Creating...</>
                ) : (
                  `Create ${batchText.split('\n').filter(l => l.trim()).length} Entities`
                )}
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => { setShowBatchCreate(false); setBatchText(''); }}>close</button>
          </form>
        </dialog>
      )}
    </div>
  );
}
