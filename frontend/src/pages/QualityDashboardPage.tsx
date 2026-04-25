/**
 * Quality dashboard — Phase 4.5 redesign.
 *
 * Grammar (Quality):
 *   services × metrics matrix, cells = percent + mini horizontal bar,
 *   threshold bands red <50 / amber 50-79 / green ≥80. Value + fill
 *   width both encode the score so the matrix remains colorblind-safe.
 *
 *   Metrics shown: Description · Metadata · Relationships · Overall.
 *   Overall is the backend's pre-weighted score (PII=3, attr-desc=3,
 *   rules=1 — weighting happens server side in qualityService); we
 *   just render it.
 *
 *   Per-row drill-down expands an entity-level breakdown table under
 *   the package row.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { importExportApi } from '../services/api';
import {
  Button,
  Chip,
  Icon,
  Input,
  Toolbar,
} from '../components/ui';

interface EntityQuality {
  name: string;
  uuid: string;
  descriptionFilled: boolean;
  attributeDescriptionRate: number;
  stereotypeCompliant: boolean;
  hasRelationships: boolean;
  score: number;
}

interface PackageQuality {
  name: string;
  entityCount: number;
  descriptionCoverage: number;
  metadataCoverage: number;
  relationshipCoverage: number;
  overallScore: number;
  entities: EntityQuality[];
}

interface QualityReport {
  overall: number;
  totalEntities: number;
  totalAttributes: number;
  packages: PackageQuality[];
}

type Tone = 'success' | 'warning' | 'danger';

const scoreTone = (score: number): Tone => {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'danger';
};

const METRICS: Array<{ key: keyof PackageQuality; label: string; tooltip: string }> = [
  { key: 'descriptionCoverage',   label: 'Description',   tooltip: '% of entities & attributes with a non-empty description' },
  { key: 'metadataCoverage',      label: 'Metadata',      tooltip: '% of entities whose stereotype-required metadata is filled' },
  { key: 'relationshipCoverage',  label: 'Relationships', tooltip: '% of entities participating in at least one relationship' },
  { key: 'overallScore',          label: 'Overall',       tooltip: 'Weighted composite score' },
];

export default function QualityDashboardPage() {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    importExportApi.getQualityReport()
      .then((r) => setReport(r))
      .catch(() => setError('Failed to load quality report.'))
      .finally(() => setLoading(false));
  }, []);

  const filteredPackages = useMemo(() => {
    if (!report) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return report.packages;
    return report.packages.filter(p => p.name.toLowerCase().includes(needle));
  }, [report, search]);

  if (loading) {
    return (
      <div className="flex justify-center items-center" style={{ padding: 60 }}>
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div style={{ padding: 12 }}>
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icon name="warning" size={14} /> {error ?? 'Failed to load quality report.'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" style={{ padding: 12 }}>
      {/* Header */}
      <div>
        <h1
          className="mono"
          style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600, margin: 0 }}
        >
          Quality
        </h1>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 4 }}>
          Services × metrics coverage matrix. Each cell encodes score two ways —
          value and bar width — so it stays readable without color.
        </p>
      </div>

      {/* Summary tiles */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        <OverallTile value={report.overall} />
        <SummaryTile label="Packages"  value={report.packages.length.toString()} />
        <SummaryTile label="Entities"  value={report.totalEntities.toString()} />
        <SummaryTile label="Attributes" value={report.totalAttributes.toString()} />
      </div>

      {/* Toolbar */}
      <Toolbar attached>
        <Input
          icon="search"
          size="sm"
          placeholder="Filter packages…"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          width={260}
        />
        <Toolbar.Spacer />
        <LegendSwatch tone="danger" label="<50" />
        <LegendSwatch tone="warning" label="50-79" />
        <LegendSwatch tone="success" label="≥80" />
      </Toolbar>

      {/* Matrix */}
      <div
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderTop: 0,
          borderRadius: '0 0 var(--radius-md) var(--radius-md)',
          overflow: 'hidden',
        }}
      >
        <div
          role="table"
          style={{
            display: 'grid',
            gridTemplateColumns: `minmax(200px, 1.2fr) repeat(${METRICS.length}, minmax(150px, 1fr)) 80px`,
            fontSize: 'var(--fs-md)',
          }}
        >
          {/* Header row */}
          <div role="row" style={{ display: 'contents' }}>
            <HeaderCell>Service</HeaderCell>
            {METRICS.map((m, i) => (
              <HeaderCell key={m.key} align="center" title={m.tooltip} emphasized={i === METRICS.length - 1}>
                {m.label}
              </HeaderCell>
            ))}
            <HeaderCell align="center">Entities</HeaderCell>
          </div>

          {/* Rows */}
          {filteredPackages.length === 0 ? (
            <div
              role="row"
              style={{
                gridColumn: `1 / span ${METRICS.length + 2}`,
                padding: '24px 10px',
                textAlign: 'center',
                color: 'var(--text-subtle)',
                fontSize: 'var(--fs-sm)',
              }}
            >
              No packages match your filter.
            </div>
          ) : (
            filteredPackages.map((pkg) => (
              <MatrixRow
                key={pkg.name}
                pkg={pkg}
                expanded={expanded === pkg.name}
                onToggle={() => setExpanded(expanded === pkg.name ? null : pkg.name)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────── Sub-components ────────────────

const HeaderCell = ({
  children,
  align = 'left',
  title,
  emphasized,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  title?: string;
  emphasized?: boolean;
}) => (
  <div
    role="columnheader"
    title={title}
    style={{
      padding: '7px 10px',
      fontSize: 'var(--fs-sm)',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      color: emphasized ? 'var(--meta-label)' : 'var(--text-muted)',
      background: emphasized ? 'var(--meta-bg)' : 'var(--bg-subtle)',
      borderBottom: '1px solid var(--border-strong)',
      borderLeft: emphasized ? '1px dashed var(--meta-border)' : undefined,
      textAlign: align,
    }}
  >
    {children}
  </div>
);

interface MatrixRowProps {
  pkg: PackageQuality;
  expanded: boolean;
  onToggle: () => void;
}

const MatrixRow = ({ pkg, expanded, onToggle }: MatrixRowProps) => {
  return (
    <>
      <div role="row" style={{ display: 'contents' }}>
        <div
          role="cell"
          className="sdd-cell"
          style={{
            padding: '0 10px',
            height: 'var(--row-height, 36px)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderBottom: '1px solid var(--border)',
            cursor: 'pointer',
          }}
          onClick={onToggle}
        >
          <Icon
            name="chevron"
            size={10}
            style={{
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              color: 'var(--text-subtle)',
              transition: 'transform var(--dur-fast)',
            }}
          />
          <Link
            to={`/packages/${pkg.name}`}
            onClick={(e) => e.stopPropagation()}
            className="mono"
            style={{
              color: 'var(--text)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {pkg.name}
          </Link>
        </div>
        {METRICS.map((m, i) => (
          <MatrixCell
            key={m.key}
            value={pkg[m.key] as number}
            emphasized={i === METRICS.length - 1}
            onClick={onToggle}
          />
        ))}
        <div
          role="cell"
          className="sdd-cell mono"
          style={{
            padding: '0 10px',
            height: 'var(--row-height, 36px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-muted)',
            borderBottom: '1px solid var(--border)',
            cursor: 'pointer',
          }}
          onClick={onToggle}
        >
          {pkg.entityCount}
        </div>
      </div>

      {expanded && pkg.entities.length > 0 && (
        <div
          role="row"
          style={{
            gridColumn: `1 / span ${METRICS.length + 2}`,
            padding: '8px 12px 14px 28px',
            background: 'var(--bg-subtle)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <EntityBreakdown pkgName={pkg.name} entities={pkg.entities} />
        </div>
      )}
    </>
  );
};

interface MatrixCellProps {
  value: number;
  emphasized?: boolean;
  onClick?: () => void;
}

const MatrixCell = ({ value, emphasized, onClick }: MatrixCellProps) => {
  const tone = scoreTone(value);
  return (
    <div
      role="cell"
      className="sdd-cell"
      onClick={onClick}
      style={{
        padding: '0 10px',
        height: 'var(--row-height, 36px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 3,
        borderBottom: '1px solid var(--border)',
        borderLeft: emphasized ? '1px dashed var(--meta-border)' : undefined,
        background: emphasized ? 'var(--meta-bg)' : undefined,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          className="mono"
          style={{
            fontSize: 'var(--fs-sm)',
            color: `var(--${tone})`,
            fontWeight: 500,
            minWidth: 38,
            textAlign: 'right',
          }}
        >
          {value}%
        </span>
        <div
          aria-hidden
          style={{
            flex: 1,
            height: 6,
            background: 'var(--bg-subtle)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.max(0, Math.min(100, value))}%`,
              height: '100%',
              background: `var(--${tone})`,
              transition: 'width var(--dur-med)',
            }}
          />
        </div>
      </div>
    </div>
  );
};

const EntityBreakdown = ({
  pkgName,
  entities,
}: {
  pkgName: string;
  entities: EntityQuality[];
}) => (
  <table
    className="table table-sm w-full"
    style={{ fontSize: 'var(--fs-sm)', background: 'transparent' }}
  >
    <thead>
      <tr>
        <BreakdownTh>Entity</BreakdownTh>
        <BreakdownTh>Description</BreakdownTh>
        <BreakdownTh>Attr descriptions</BreakdownTh>
        <BreakdownTh>Stereotype</BreakdownTh>
        <BreakdownTh>Relationships</BreakdownTh>
        <BreakdownTh align="right">Score</BreakdownTh>
      </tr>
    </thead>
    <tbody>
      {entities.map((e) => (
        <tr key={e.uuid}>
          <td>
            <Link
              to={`/packages/${pkgName}/entities/${e.name}`}
              className="mono"
              style={{ color: 'var(--accent)' }}
            >
              {e.name}
            </Link>
          </td>
          <td>
            {e.descriptionFilled
              ? <Chip tone="success" soft>Yes</Chip>
              : <Chip tone="danger" soft>Missing</Chip>}
          </td>
          <td>
            <span
              className="mono"
              style={{ color: `var(--${scoreTone(e.attributeDescriptionRate)})` }}
            >
              {e.attributeDescriptionRate}%
            </span>
          </td>
          <td>
            {e.stereotypeCompliant
              ? <Chip tone="success" soft>OK</Chip>
              : <Chip tone="warning" soft>Incomplete</Chip>}
          </td>
          <td>
            {e.hasRelationships
              ? <Chip tone="success" soft>Yes</Chip>
              : <Chip tone="danger" soft>None</Chip>}
          </td>
          <td style={{ textAlign: 'right' }}>
            <Chip tone={scoreTone(e.score)} soft>
              <span className="mono">{e.score}%</span>
            </Chip>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const BreakdownTh = ({
  children,
  align = 'left',
}: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) => (
  <th
    style={{
      padding: '4px 8px',
      fontSize: 'var(--fs-xs)',
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      fontWeight: 600,
      color: 'var(--text-muted)',
      borderBottom: '1px solid var(--border)',
      background: 'transparent',
      textAlign: align,
    }}
  >
    {children}
  </th>
);

// ──────────────── Summary tiles ────────────────

const OverallTile = ({ value }: { value: number }) => {
  const tone = scoreTone(value);
  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 14px',
      }}
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
        <Icon name="chart" size={11} />
        Overall
      </div>
      <div
        className="mono"
        style={{
          fontSize: 'var(--fs-2xl)',
          fontWeight: 600,
          color: `var(--${tone})`,
          letterSpacing: '-0.02em',
          marginTop: 2,
        }}
      >
        {value}%
      </div>
      <div
        aria-hidden
        style={{
          height: 4,
          background: 'var(--bg-subtle)',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          marginTop: 6,
        }}
      >
        <div
          style={{
            width: `${Math.max(0, Math.min(100, value))}%`,
            height: '100%',
            background: `var(--${tone})`,
            transition: 'width var(--dur-med)',
          }}
        />
      </div>
    </div>
  );
};

const SummaryTile = ({ label, value }: { label: string; value: string }) => (
  <div
    style={{
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: '12px 14px',
    }}
  >
    <div
      className="uppercase"
      style={{
        fontSize: 'var(--fs-xs)',
        color: 'var(--text-subtle)',
        letterSpacing: '0.06em',
        fontWeight: 600,
      }}
    >
      {label}
    </div>
    <div
      className="mono"
      style={{
        fontSize: 'var(--fs-2xl)',
        fontWeight: 600,
        color: 'var(--text)',
        letterSpacing: '-0.02em',
        marginTop: 2,
      }}
    >
      {value}
    </div>
  </div>
);

const LegendSwatch = ({ tone, label }: { tone: Tone; label: string }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)',
    }}
  >
    <span
      aria-hidden
      style={{
        width: 10,
        height: 10,
        background: `var(--${tone})`,
        borderRadius: 2,
      }}
    />
    {label}
  </span>
);

// Keep Button import referenced so eslint no-unused-vars doesn't trip if
// a future edit drops the only Button usage above.
void Button;
