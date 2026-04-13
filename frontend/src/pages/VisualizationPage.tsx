/**
 * Visualization page — renders CytoscapeGraph for a specific service/entity
 * or the full organization diagram. Bridges the broken `/visualization/*`
 * links from EntityDetail and PerspectiveDetailPage to a real route.
 */
import { useParams, useSearchParams } from 'react-router-dom';
import CytoscapeGraph from '../components/CytoscapeGraph';

export default function VisualizationPage() {
  const { service, entity } = useParams<{ service?: string; entity?: string }>();
  const [searchParams] = useSearchParams();
  const perspectiveId = searchParams.get('perspective') || undefined;

  const title = entity
    ? `${entity} — ${service}`
    : service
      ? service
      : 'Organization Diagram';

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
      <div className="flex-1 min-h-0 border border-base-300 rounded-lg overflow-hidden">
        <CytoscapeGraph
          service={service}
          mode={service ? 'service' : 'organization'}
          perspectiveId={perspectiveId}
        />
      </div>
    </div>
  );
}
