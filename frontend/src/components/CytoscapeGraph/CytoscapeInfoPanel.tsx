import { useEffect, useRef, useState } from 'react';
import type { InfoPanelData } from './CytoscapeGraph.types';
import { buildNodeInfo } from './nodeInfo';

interface CytoscapeInfoPanelProps {
  data: InfoPanelData;
  onClose: () => void;
  onNavigate?: (service: string, entity: string) => void;
  /** Focus this entity on the canvas (zoom to its neighbourhood). */
  onFocus?: (nodeId: string) => void;
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 760;
const DEFAULT_WIDTH = 320;

export default function CytoscapeInfoPanel({ data, onClose, onNavigate, onFocus }: CytoscapeInfoPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const draggingRef = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      // Panel is right-anchored — width grows as the cursor moves left.
      const next = window.innerWidth - e.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startResize = () => {
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      className="absolute right-0 top-0 h-full bg-base-100 border-l border-base-300 shadow-lg z-40 flex"
      style={{ width }}
    >
      {/* Drag handle — resize the panel horizontally. */}
      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
        onMouseDown={startResize}
        className="w-1.5 h-full shrink-0 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
      />
      <div className="flex-1 overflow-y-auto min-w-0">
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

            {/* Focus button — zoom to this entity and its direct neighbours. */}
            {data.id && onFocus && (
              <button
                className="btn btn-outline btn-sm mb-2 w-full"
                onClick={() => onFocus(data.id!)}
                title="Focus: zoom to this entity and its direct neighbours"
              >
                ◎ Focus on entity
              </button>
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
            {/* Always reserve the required-marker slot so the type column aligns
                whether or not the field is required. */}
            <span className="text-error w-2 shrink-0 text-center">{attr.required ? '*' : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
