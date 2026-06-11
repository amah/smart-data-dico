/**
 * Diagram page — renders CytoscapeGraph for the full organization, a specific
 * service, or a single entity. Mounted on `/diagram`, `/diagram/:service` and
 * `/diagram/:service/:entity`; the EntityDetail and CaseDetailPage links target
 * these routes.
 *
 * A page-level tab switcher (#181/#182) selects the diagram view mode
 * (structural / physical). An explicit `?view=` URL param wins (deep links
 * stay deterministic); otherwise the last choice is sticky via localStorage,
 * defaulting to structural. The title block is collapsible, sharing the
 * sticky expanded/collapsed preference with PageHeader descriptions.
 */
import { useParams, useSearchParams } from 'react-router-dom';
import CytoscapeGraph from '../components/CytoscapeGraph';
import Breadcrumbs from '../components/Breadcrumbs';
import PageHeader, { useDescriptionExpanded } from '../components/ui/PageHeader';
import { useStoredState } from '../hooks/useStoredState';
import {
  VIEW_MODES,
  VIEW_MODE_LABELS,
  DEFAULT_VIEW_MODE,
  type ViewMode,
} from '../components/CytoscapeGraph/viewMode';

const isViewMode = (raw: string): raw is ViewMode =>
  (VIEW_MODES as readonly string[]).includes(raw);

export default function VisualizationPage() {
  const { service, entity } = useParams<{ service?: string; entity?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const caseId = searchParams.get('case') || searchParams.get('perspective') || undefined;
  const [storedView, setStoredView] = useStoredState('sdd-diagram-view', DEFAULT_VIEW_MODE, isViewMode);
  const urlView = searchParams.get('view');
  const viewMode: ViewMode = urlView && isViewMode(urlView) ? urlView : storedView;

  const setViewMode = (next: ViewMode) => {
    setStoredView(next);
    const params = new URLSearchParams(searchParams);
    // The default mode is omitted to keep the URL clean.
    if (next === DEFAULT_VIEW_MODE) params.delete('view');
    else params.set('view', next);
    setSearchParams(params, { replace: true });
  };

  const description = entity
    ? `Entity graph for ${entity} and its relationships`
    : service
      ? `All entities in ${service}`
      : 'All entities and relationships across all packages';

  // Collapsed by default to give the diagram more room; the chevron sits
  // right after the breadcrumb's package name. Shares the sticky preference
  // with PageHeader descriptions.
  const [descExpanded, toggleDescExpanded] = useDescriptionExpanded();

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* PageHeader suppresses the shell's duplicate breadcrumb; the chevron is
          placed inside the breadcrumb slot so it sits in front of (right after)
          the package name rather than at the far right. */}
      <PageHeader
        className="mb-1"
        breadcrumb={
          <div className="flex items-center gap-1 min-w-0">
            <Breadcrumbs />
            <button
              type="button"
              onClick={toggleDescExpanded}
              aria-expanded={descExpanded}
              aria-label={descExpanded ? 'Hide description' : 'Show description'}
              title={descExpanded ? 'Hide description' : 'Show description'}
              className="btn btn-ghost btn-xs btn-circle shrink-0"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                fill="currentColor"
                style={{ transition: 'transform 150ms', transform: descExpanded ? 'rotate(180deg)' : 'none' }}
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        }
      />
      {descExpanded && (
        <p className="text-base-content/60 text-sm mb-1 ml-1">{description}</p>
      )}

      {/* View-mode tabs (#182) */}
      <div
        role="tablist"
        aria-label="Diagram view mode"
        style={{
          display: 'flex',
          gap: 0,
          padding: '0 8px',
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderBottom: 0,
          borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
        }}
      >
        {VIEW_MODES.map((m) => {
          const isActive = viewMode === m;
          return (
            <button
              key={m}
              role="tab"
              aria-selected={isActive}
              onClick={() => setViewMode(m)}
              style={{
                padding: '8px 12px',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                color: isActive ? 'var(--text)' : 'var(--text-muted)',
                fontSize: 'var(--fs-sm)',
                fontWeight: isActive ? 600 : 400,
                marginBottom: -1,
                cursor: 'pointer',
              }}
            >
              {VIEW_MODE_LABELS[m]}
            </button>
          );
        })}
      </div>

      <div
        className="flex-1 min-h-0 border border-base-300 overflow-hidden"
        style={{ borderRadius: '0 0 var(--radius-md) var(--radius-md)' }}
      >
        <CytoscapeGraph
          service={service}
          mode={service ? 'service' : 'organization'}
          viewMode={viewMode}
          caseId={caseId}
        />
      </div>
    </div>
  );
}
