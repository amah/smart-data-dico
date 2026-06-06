import type { InfoPanelData } from './CytoscapeGraph.types';
import { buildNodeInfo } from './nodeInfo';

interface CytoscapeInfoPanelProps {
  data: InfoPanelData;
  onClose: () => void;
  onNavigate?: (service: string, entity: string) => void;
}

export default function CytoscapeInfoPanel({ data, onClose, onNavigate }: CytoscapeInfoPanelProps) {
  return (
    <div className="absolute right-0 top-0 h-full w-80 bg-base-100 border-l border-base-300 shadow-lg overflow-y-auto z-40">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg text-base-content">{data.label}</h3>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-circle"
          >
            &times;
          </button>
        </div>

        {data.type === 'node' && (
          <>
            {data.service && (
              <div className="badge badge-outline badge-sm mb-2">{data.service}</div>
            )}
            {data.description && (
              <p className="text-sm text-base-content/80 mb-3">{data.description}</p>
            )}

            {/* Navigate button */}
            {data.service && onNavigate && (
              <button
                className="btn btn-primary btn-sm mb-3 w-full"
                onClick={() => onNavigate(data.service!, data.label)}
              >
                View Entity Details
              </button>
            )}

            {/* Per-mode node detail (#188) — compact nodes, detail here. */}
            <NodeDetail data={data} />
          </>
        )}

        {data.type === 'edge' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono">{data.sourceLabel}</span>
              <span className="badge badge-sm">{data.sourceCardinality}</span>
              <span>&rarr;</span>
              <span className="badge badge-sm">{data.targetCardinality}</span>
              <span className="font-mono">{data.targetLabel}</span>
            </div>
            <div className="text-xs opacity-60">
              Cardinality: {data.sourceCardinality === 'many' ? 'N' : '1'}
              :
              {data.targetCardinality === 'many' ? 'N' : '1'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Mode-aware node detail (#188). Nodes are compact in every view, so the
 * attribute / column / ORM detail surfaces here, varying by view mode.
 */
function NodeDetail({ data }: { data: InfoPanelData }) {
  const info = buildNodeInfo(data.viewMode, data.attributes ?? [], data.constraints ?? []);

  if (info.mode === 'logical') {
    if (info.attributes.length === 0) return null;
    return (
      <div>
        <h4 className="font-semibold text-sm mb-2">Attributes ({info.attributes.length})</h4>
        <div className="space-y-1">
          {info.attributes.map((attr) => (
            <div key={attr.name} className="text-xs px-2 py-1 rounded bg-base-200">
              <div className="flex items-center gap-2">
                <span className="font-mono">{attr.name}</span>
                {attr.javaType && <span className="opacity-50 ml-auto">{attr.javaType}</span>}
              </div>
              {attr.facts.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {attr.facts.map((f) => (
                    <span key={f} className="badge badge-outline badge-xs font-mono">{f}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (info.mode === 'physical') {
    return (
      <>
        {info.columns.length > 0 && (
          <div className="mb-3">
            <h4 className="font-semibold text-sm mb-2">Columns ({info.columns.length})</h4>
            <div className="space-y-1">
              {info.columns.map((col) => (
                <div key={col.name} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-base-200">
                  {col.flags.map((flag) => (
                    <span key={flag} className="badge badge-primary badge-xs">{flag}</span>
                  ))}
                  <span className="font-mono">{col.name}</span>
                  {col.dbType && <span className="opacity-50 ml-auto font-mono">{col.dbType}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {info.constraints.length > 0 && (
          <div>
            <h4 className="font-semibold text-sm mb-2">Constraints ({info.constraints.length})</h4>
            <div className="space-y-1">
              {info.constraints.map((c, i) => (
                <div key={`${c.kind}-${i}`} className="flex items-start gap-2 text-xs px-2 py-1 rounded bg-base-200">
                  <span className="badge badge-ghost badge-xs">{c.kind}</span>
                  <span className="font-mono break-all">{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }

  // Structural (default) — unchanged.
  if (info.attributes.length === 0) return null;
  return (
    <div>
      <h4 className="font-semibold text-sm mb-2">Attributes ({info.attributes.length})</h4>
      <div className="space-y-1">
        {info.attributes.map((attr) => (
          <div key={attr.name} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-base-200">
            {attr.primaryKey && <span className="badge badge-primary badge-xs">PK</span>}
            <span className="font-mono">{attr.name}</span>
            <span className="opacity-50 ml-auto">{attr.type}</span>
            {attr.required && <span className="text-error">*</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
