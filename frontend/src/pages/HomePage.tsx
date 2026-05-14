/**
 * Home / Packages landing — Phase 4.4 redesign.
 *
 * Grammar (Home / Packages):
 *   - workspace KPI strip: 4 tiles (Quality · Integrity · Open diff ·
 *     Physical sync)
 *   - package cards in a 3-col auto-fit grid (minmax(320px, 1fr), 16px
 *     gap). Primary action "Open"; Diagram demoted to a ghost icon
 *     button; other actions live in a kebab Menu.
 *   - "Recently viewed" band below, keyed off the existing
 *     useRecentPackages store.
 *
 * KPI data sources:
 *   - Quality      → importExportApi.getQualityReport() → overall %
 *   - Integrity    → IntegrityService.getReport() → count of severity=error
 *   - Open diff    → gitApi.getStatus() → uncommitted file count
 *   - Physical sync → placeholder (— "not run") until the Phase 6
 *     drift job is wired up
 */

import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  servicesApi,
  packageApi,
  gitApi,
  importExportApi,
} from '../services/api';
import { useService } from '../kernel/useService';
import { INTEGRITY_SERVICE_TOKEN } from '../kernel/tokens';
import type { IntegrityService } from '../plugins/data-dictionary/services/IntegrityService';
import { getRecentPackages } from '../hooks/useRecentPackages';
import {
  Button,
  Chip,
  Icon,
  Input,
  Menu,
  Toolbar,
  type IconName,
} from '../components/ui';

type SortKey = 'name' | 'entities' | 'rels' | 'quality';

interface PackageCard {
  name: string;
  description?: string;
  type?: string;
  entityCount: number;
  attributeCount: number;
  relationshipCount: number;
  qualityScore?: number;
}

interface Kpis {
  quality: number | null;     // overall %, 0-100
  integrityErrors: number | null;
  openDiff: number | null;    // uncommitted file count
  physicalSync: 'not-run';    // forward-compat placeholder
}

const scoreTone = (score: number): 'success' | 'warning' | 'danger' => {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'danger';
};

const HomePage = () => {
  const [packages, setPackages] = useState<PackageCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [kpis, setKpis] = useState<Kpis>({
    quality: null,
    integrityErrors: null,
    openDiff: null,
    physicalSync: 'not-run',
  });

  // Pattern B integrity service — resolved once per render via the kernel.
  const integrity = useService<IntegrityService>(INTEGRITY_SERVICE_TOKEN);

  // Load packages + per-package quality breakdown in parallel.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await servicesApi.getAllServices();
        const services: string[] = res.data || [];

        const [pkgResults, qualityReport] = await Promise.all([
          Promise.all(services.map(async (name) => {
            try {
              const pkg = await packageApi.getPackageByPath(name, []);
              const entities = pkg.entities || [];
              const rels = pkg.relationships || [];
              const attrCount = entities.reduce(
                (s: number, e: any) => s + (e.attributes?.length || 0),
                0,
              );
              return {
                name,
                description: pkg.description,
                type: (pkg.type as string) || undefined,
                entityCount: entities.length,
                attributeCount: attrCount,
                relationshipCount: rels.length,
              } as PackageCard;
            } catch {
              return { name, entityCount: 0, attributeCount: 0, relationshipCount: 0 };
            }
          })),
          importExportApi.getQualityReport().catch(() => null),
        ]);

        if (cancelled) return;

        // Fold quality scores into each card (map by name).
        const qualityByName: Record<string, number> = {};
        if (qualityReport && Array.isArray(qualityReport.packages)) {
          for (const p of qualityReport.packages) {
            qualityByName[p.name] = p.overallScore;
          }
        }
        const withQuality = pkgResults.map(p => ({
          ...p,
          qualityScore: qualityByName[p.name],
        }));
        setPackages(withQuality);

        setKpis(prev => ({
          ...prev,
          quality: qualityReport?.overall ?? null,
        }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Integrity + git-status KPIs — independent fetches; best-effort.
  useEffect(() => {
    let cancelled = false;
    integrity.getReport()
      .then((report) => {
        if (cancelled) return;
        const errors = (report.rules || []).filter((r: any) => r.severity === 'error').length;
        setKpis(prev => ({ ...prev, integrityErrors: errors }));
      })
      .catch(() => { /* best effort */ });

    gitApi.getStatus()
      .then((status: any) => {
        if (cancelled) return;
        const dirty =
          (status?.files?.length) ??
          ((status?.modified?.length || 0) +
            (status?.not_added?.length || 0) +
            (status?.created?.length || 0) +
            (status?.deleted?.length || 0));
        setKpis(prev => ({ ...prev, openDiff: dirty }));
      })
      .catch(() => { /* best effort */ });

    return () => { cancelled = true; };
  }, [integrity]);

  const totalEntities = packages.reduce((sum, pkg) => sum + pkg.entityCount, 0);
  const totalRels = packages.reduce((sum, pkg) => sum + pkg.relationshipCount, 0);

  const visiblePackages = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? packages.filter(p =>
          p.name.toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q),
        )
      : packages;
    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'entities':  return b.entityCount - a.entityCount;
        case 'rels':      return b.relationshipCount - a.relationshipCount;
        case 'quality':   return (b.qualityScore ?? -1) - (a.qualityScore ?? -1);
        default:          return a.name.localeCompare(b.name);
      }
    });
    return sorted;
  }, [packages, filter, sortKey]);

  const recents = useMemo(
    () => getRecentPackages().filter(name => packages.some(p => p.name === name)),
    [packages],
  );

  return (
    <div className="flex flex-col gap-4" style={{ padding: 12 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div>
          <h1
            className="mono"
            style={{ fontSize: 'var(--fs-3xl)', fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}
          >
            Data Dictionary
          </h1>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 4 }}>
            {packages.length} packages · {totalEntities} entities · {totalRels} relationships
          </p>
        </div>
        <Link to="/packages">
          <Button size="md" variant="primary" icon="plus">New package</Button>
        </Link>
      </div>

      {/* KPI strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        <KpiTile
          label="Quality"
          icon="chart"
          valueRender={() => kpis.quality === null
            ? <Unknown />
            : <span style={{ color: `var(--${scoreTone(kpis.quality)})` }}>{kpis.quality}%</span>}
          href="/quality"
          extra={kpis.quality !== null && <ProgressBar value={kpis.quality} tone={scoreTone(kpis.quality)} />}
        />
        <KpiTile
          label="Integrity"
          icon="shield"
          valueRender={() => kpis.integrityErrors === null
            ? <Unknown />
            : (
                <span style={{ color: kpis.integrityErrors > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {kpis.integrityErrors}
                </span>
              )}
          href="/integrity"
          extra={kpis.integrityErrors !== null && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
              {kpis.integrityErrors === 0 ? 'no errors' : `${kpis.integrityErrors} to review`}
            </span>
          )}
        />
        <KpiTile
          label="Open diff"
          icon="branch"
          valueRender={() => kpis.openDiff === null
            ? <Unknown />
            : <span style={{ color: kpis.openDiff > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>{kpis.openDiff}</span>}
          href="/version/history"
          extra={kpis.openDiff !== null && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
              {kpis.openDiff === 0 ? 'clean working tree' : `${kpis.openDiff} uncommitted`}
            </span>
          )}
        />
        <KpiTile
          label="Physical sync"
          icon="layers"
          valueRender={() => <Unknown />}
          href="/integrity"
          extra={
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
              drift report not run
            </span>
          }
        />
      </div>

      {loading ? (
        <div className="flex justify-center" style={{ padding: 40 }}>
          <span className="loading loading-spinner loading-lg" />
        </div>
      ) : packages.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Recently viewed */}
          {recents.length > 0 && (
            <div>
              <div
                className="uppercase"
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-subtle)',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                Recently viewed
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {recents.map((name) => (
                  <Link key={name} to={`/packages/${name}`}>
                    <Chip tone="meta" className="mono">
                      <Icon name="folder" size={10} /> <span style={{ marginLeft: 4 }}>{name}</span>
                    </Chip>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Toolbar */}
          <Toolbar>
            <Input
              icon="search"
              size="sm"
              placeholder="Filter packages…"
              value={filter}
              onChange={(e) => setFilter(e.currentTarget.value)}
              width={260}
            />
            <SortSelect value={sortKey} onChange={setSortKey} />
            <Toolbar.Spacer />
            {filter && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
                {visiblePackages.length} of {packages.length}
              </span>
            )}
          </Toolbar>

          {/* Package grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 16,
            }}
          >
            {visiblePackages.map((pkg) => (
              <PackageCardView key={pkg.name} pkg={pkg} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ──────────────── Pieces ────────────────

const EmptyState = () => (
  <div
    style={{
      padding: '36px 20px',
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      textAlign: 'center',
    }}
  >
    <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, marginBottom: 4 }}>No packages yet</h2>
    <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
      Create your first package to start modeling your data.
    </p>
    <div style={{ marginTop: 14 }}>
      <Link to="/packages">
        <Button size="md" variant="primary" icon="plus">Create package</Button>
      </Link>
    </div>
  </div>
);

interface KpiTileProps {
  label: string;
  icon: IconName;
  valueRender: () => React.ReactNode;
  href?: string;
  extra?: React.ReactNode;
}

const KpiTile = ({ label, icon, valueRender, href, extra }: KpiTileProps) => {
  const body = (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        height: '100%',
        cursor: href ? 'pointer' : undefined,
        transition: 'border-color var(--dur-fast)',
      }}
      onMouseEnter={(e) => { if (href) e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
      onMouseLeave={(e) => { if (href) e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      <div
        className="uppercase"
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-subtle)',
          letterSpacing: '0.06em',
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Icon name={icon} size={11} />
        {label}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 'var(--fs-2xl)',
          fontWeight: 600,
          color: 'var(--text)',
          letterSpacing: '-0.02em',
          lineHeight: 1.2,
        }}
      >
        {valueRender()}
      </div>
      {extra}
    </div>
  );
  return href ? <Link to={href} style={{ color: 'inherit' }}>{body}</Link> : body;
};

const Unknown = () => (
  <span style={{ color: 'var(--text-subtle)', fontSize: 'var(--fs-xl)' }}>—</span>
);

const ProgressBar = ({ value, tone }: { value: number; tone: 'success' | 'warning' | 'danger' }) => {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      aria-hidden
      style={{
        width: '100%',
        height: 4,
        background: 'var(--bg-subtle)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        marginTop: 4,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: `var(--${tone})`,
          transition: 'width var(--dur-med)',
        }}
      />
    </div>
  );
};

const SortSelect = ({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) => (
  <label
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-muted)',
    }}
  >
    <Icon name="sort" size={12} />
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SortKey)}
      style={{
        height: 28,
        padding: '0 6px',
        fontSize: 'var(--fs-sm)',
        fontFamily: 'inherit',
        background: 'var(--bg-raised)',
        color: 'var(--text)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <option value="name">name</option>
      <option value="entities">most entities</option>
      <option value="rels">most relationships</option>
      <option value="quality">highest quality</option>
    </select>
  </label>
);

// ──────────────── Package card ────────────────

const PackageCardView = ({ pkg }: { pkg: PackageCard }) => {
  const tone = pkg.qualityScore !== undefined ? scoreTone(pkg.qualityScore) : null;
  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-strong)';
        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <h3
          className="mono"
          style={{
            fontSize: 'var(--fs-lg)',
            fontWeight: 600,
            margin: 0,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={pkg.name}
        >
          {pkg.name}
        </h3>
        {pkg.type && <Chip tone="meta">{pkg.type}</Chip>}
      </div>

      {pkg.description && (
        <p
          style={{
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-muted)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            margin: 0,
            lineHeight: 1.4,
          }}
          title={pkg.description}
        >
          {pkg.description}
        </p>
      )}

      <div
        className="mono"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-subtle)',
          marginTop: 2,
        }}
      >
        <span><strong style={{ color: 'var(--text-muted)' }}>{pkg.entityCount}</strong> entities</span>
        <span>·</span>
        <span><strong style={{ color: 'var(--text-muted)' }}>{pkg.attributeCount}</strong> attrs</span>
        <span>·</span>
        <span><strong style={{ color: 'var(--text-muted)' }}>{pkg.relationshipCount}</strong> rels</span>
      </div>

      {pkg.qualityScore !== undefined && tone && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <ProgressBar value={pkg.qualityScore} tone={tone} />
          </div>
          <span
            className="mono"
            style={{
              fontSize: 'var(--fs-xs)',
              color: `var(--${tone})`,
              minWidth: 36,
              textAlign: 'right',
            }}
          >
            {pkg.qualityScore}%
          </span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <Link to={`/packages/${pkg.name}`} style={{ display: 'inline-flex', flex: 1 }}>
          <Button size="md" variant="primary" icon="folder" style={{ width: '100%', justifyContent: 'center' }}>
            Open
          </Button>
        </Link>
        <Link to={`/packages/${pkg.name}?view=graph`}>
          <Button size="md" variant="ghost" icon="chart" iconOnly aria-label="Diagram" />
        </Link>
        <Menu
          align="end"
          width={180}
          trigger={({ toggle, open }) => (
            <Button size="md" variant="ghost" icon="moreV" iconOnly aria-label="More" pressed={open} onClick={toggle} />
          )}
        >
          {({ close }) => (
            <div>
              <MenuItem href={`/packages/${pkg.name}`} onClose={close}>Open</MenuItem>
              <MenuItem href={`/packages/${pkg.name}?view=graph`} onClose={close}>Diagram</MenuItem>
              <MenuItem href={`/quality`} onClose={close}>Quality report</MenuItem>
              <MenuItem href={`/version/history`} onClose={close}>Commit history</MenuItem>
            </div>
          )}
        </Menu>
      </div>
    </div>
  );
};

const MenuItem = ({ href, onClose, children }: { href: string; onClose: () => void; children: React.ReactNode }) => (
  <Link
    to={href}
    onClick={onClose}
    style={{
      display: 'block',
      padding: '6px 8px',
      fontSize: 'var(--fs-sm)',
      color: 'var(--text)',
      borderRadius: 'var(--radius-sm)',
      textDecoration: 'none',
    }}
    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--bg-hover)'; }}
    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
  >
    {children}
  </Link>
);

export default HomePage;
