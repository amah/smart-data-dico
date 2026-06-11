/**
 * Diagram page — thin route wrapper around {@link DiagramViewer} for the full
 * organization, a specific service, or a single entity. Mounted on `/diagram`,
 * `/diagram/:service` and `/diagram/:service/:entity`; the EntityDetail and
 * CaseDetailPage links target these routes.
 *
 * The Structural/Physical mode lives in DiagramViewer (sticky preference;
 * here the `?view=` URL param wins for deep links). The title block is
 * collapsible, sharing the sticky expanded/collapsed preference with
 * PageHeader descriptions.
 */
import { useParams, useSearchParams } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs';
import PageHeader, { useDescriptionExpanded } from '../components/ui/PageHeader';
import DiagramViewer from '../components/CytoscapeGraph/DiagramViewer';

export default function VisualizationPage() {
  const { service, entity } = useParams<{ service?: string; entity?: string }>();
  const [searchParams] = useSearchParams();
  const caseId = searchParams.get('case') || searchParams.get('perspective') || undefined;

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

      <DiagramViewer
        service={service}
        mode={service ? 'service' : 'organization'}
        caseId={caseId}
        syncViewToUrl
      />
    </div>
  );
}
