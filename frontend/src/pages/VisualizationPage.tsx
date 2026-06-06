/**
 * Visualization page — renders CytoscapeGraph for a specific service/entity
 * or the full organization diagram. Bridges the broken `/visualization/*`
 * links from EntityDetail and CaseDetailPage to a real route.
 *
 * A page-level tab switcher (#181/#182) selects the diagram view mode
 * (structural / logical / physical), persisted in the URL as `?view=`.
 */
import { useParams, useSearchParams } from 'react-router-dom';
import CytoscapeGraph from '../components/CytoscapeGraph';
import {
  VIEW_MODES,
  VIEW_MODE_LABELS,
  parseViewMode,
} from '../components/CytoscapeGraph/viewMode';

export default function VisualizationPage() {
  const { service, entity } = useParams<{ service?: string; entity?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const caseId = searchParams.get('case') || searchParams.get('perspective') || undefined;
  const viewMode = parseViewMode(searchParams.get('view'));

  const setViewMode = (next: string) => {
    const params = new URLSearchParams(searchParams);
    // `structural` is the default — keep the URL clean by omitting it.
    if (next === 'structural') params.delete('view');
    else params.set('view', next);
    setSearchParams(params, { replace: true });
  };

  const title = entity
    ? `${entity} — ${service}`
    : service
      ? service
      : 'Diagram';

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-base-content/60 text-sm">
            {entity
              ? `Entity graph for ${entity} and its relationships`
              : service
                ? `All entities in ${service}`
                : 'All entities and relationships across all packages'}
          </p>
        </div>
      </div>

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
