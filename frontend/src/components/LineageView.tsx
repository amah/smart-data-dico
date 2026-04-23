import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { servicesApi } from '../services/api';
import type { LineageResult, LineageNode } from '../types';

interface LineageViewProps {
  entityUuid: string;
  service: string;
}

function LineageNodeCard({ node }: { node: LineageNode }) {
  return (
    <div className="flex items-center gap-2 p-2 bg-base-200 rounded" style={{ marginLeft: `${(node.depth - 1) * 24}px` }}>
      <span className={`badge badge-xs ${node.direction === 'upstream' ? 'badge-info' : 'badge-warning'}`}>
        {node.direction === 'upstream' ? '\u2191' : '\u2193'}
      </span>
      <Link to={`/packages/${node.service}/entities/${node.entityName}`} className="link link-primary font-mono text-sm">
        {node.entityName}
      </Link>
      <span className="badge badge-ghost badge-xs">{node.service}</span>
      {node.relationship.description && (
        <span className="text-xs text-base-content/60 italic">{node.relationship.description}</span>
      )}
    </div>
  );
}

export default function LineageView({ entityUuid }: LineageViewProps) {
  const [lineage, setLineage] = useState<LineageResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!entityUuid) return;
    setLoading(true);
    servicesApi.getLineage(entityUuid)
      .then(setLineage)
      .catch(() => setLineage(null))
      .finally(() => setLoading(false));
  }, [entityUuid]);

  if (loading) return <span className="loading loading-spinner loading-sm" />;

  if (!lineage) return <p className="text-sm text-base-content/50">Failed to load lineage data.</p>;

  const hasLineage = lineage.upstream.length > 0 || lineage.downstream.length > 0;

  return (
    <div className="space-y-6">
      {!hasLineage && (
        <div className="text-center py-8 text-base-content/50">
          <p>No lineage relationships defined for this entity.</p>
          <p className="text-xs mt-1">Create relationships with type "lineage" to track data flow.</p>
        </div>
      )}

      {/* Upstream */}
      {lineage.upstream.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2 flex items-center gap-2">
            <span className="badge badge-info badge-sm">Upstream</span>
            Data flows FROM ({lineage.upstream.length})
          </h4>
          <div className="space-y-1">
            {lineage.upstream.map((node, i) => (
              <LineageNodeCard key={`${node.entityUuid}-${i}`} node={node} />
            ))}
          </div>
        </div>
      )}

      {/* Current entity */}
      {hasLineage && (
        <div className="flex items-center justify-center py-2">
          <div className="p-3 bg-primary/10 border-2 border-primary rounded-lg font-bold">
            {lineage.entity.name}
            <span className="badge badge-ghost badge-xs ml-2">{lineage.entity.service}</span>
          </div>
        </div>
      )}

      {/* Downstream */}
      {lineage.downstream.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2 flex items-center gap-2">
            <span className="badge badge-warning badge-sm">Downstream</span>
            Data flows TO ({lineage.downstream.length})
          </h4>
          <div className="space-y-1">
            {lineage.downstream.map((node, i) => (
              <LineageNodeCard key={`${node.entityUuid}-${i}`} node={node} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
