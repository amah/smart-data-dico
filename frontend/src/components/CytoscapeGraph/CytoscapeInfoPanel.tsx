import { useEffect, useRef, useState } from 'react';
import type { Attribute } from '../../types';
import type { InfoPanelData } from './CytoscapeGraph.types';
import type { ElementStyle } from '../../utils/elementStyle';
import { CLEAR_STYLE } from './useFormatPainter';
import { buildNodeInfo } from './nodeInfo';

interface CytoscapeInfoPanelProps {
  data: InfoPanelData;
  onClose: () => void;
  onNavigate?: (service: string, entity: string) => void;
  /** Embeddable entities (name → attributes) for flattening @Embedded columns. */
  embeddables?: Map<string, Attribute[]>;
  /** Element styles for the Appearance picker (format painter). */
  styles?: ElementStyle[];
  /** Apply a style name (or null to clear) to this entity. */
  onApplyStyle?: (styleName: string | null) => void;
  /** Copy this entity's style to the painter clipboard and arm the brush. */
  onCopyFormat?: (styleName: string | null) => void;
  /** Paste the clipboard style onto this entity. */
  onPasteFormat?: () => void;
  /** Current painter clipboard (drives the Paste button's enabled state). */
  clipboard?: string | null;
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 760;
const DEFAULT_WIDTH = 320;

export default function CytoscapeInfoPanel({
  data, onClose, onNavigate, embeddables, styles, onApplyStyle, onCopyFormat, onPasteFormat, clipboard,
}: CytoscapeInfoPanelProps) {
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
        {/* Header — name, a compact "view details" icon, and close. Description,
            package badge and the Focus button are dropped to make room for the
            attribute list (focus is still available via double-click). */}
        <div className="flex items-center justify-between gap-1 mb-3">
          <div className="flex items-center gap-1 min-w-0">
            <h3 className="font-bold text-lg text-base-content truncate">{data.label}</h3>
            {data.type === 'node' && data.service && onNavigate && (
              <button
                onClick={() => onNavigate(data.service!, data.label)}
                className="btn btn-ghost btn-xs btn-circle shrink-0"
                title="View entity details"
                aria-label="View entity details"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17 17 7M8 7h9v9" />
                </svg>
              </button>
            )}
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm btn-circle shrink-0">
            &times;
          </button>
        </div>

        {/* Appearance (#element-style) — pick a style from the list, or copy/paste
            the format between entities (the toolbar brush paints many). */}
        {data.type === 'node' && styles && styles.length > 0 && onApplyStyle && (
          <div className="mb-3 pb-3 border-b border-base-300">
            <h4 className="font-semibold text-sm mb-2">Appearance</h4>
            <select
              className="select select-xs select-bordered w-full"
              value={data.styleName ?? ''}
              onChange={(e) => onApplyStyle(e.target.value || null)}
              title="Element style for this entity (persists as a non-destructive override)"
            >
              <option value="">Default (no explicit style)</option>
              {styles.map((s) => (
                <option key={s.name} value={s.name}>{s.label || s.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-1 mt-2">
              <button
                className="btn btn-xs btn-ghost"
                onClick={() => onCopyFormat?.(data.styleName ?? null)}
                title="Copy this entity's style, then click other entities to paint it"
              >
                Copy format
              </button>
              <button
                className="btn btn-xs btn-ghost"
                onClick={() => onPasteFormat?.()}
                disabled={clipboard == null}
                title={clipboard == null
                  ? 'Nothing copied yet'
                  : `Apply the copied style (${clipboard === CLEAR_STYLE ? 'Default' : clipboard}) to this entity`}
              >
                Paste format
              </button>
            </div>
          </div>
        )}

        {/* Per-mode node detail (#188) — compact nodes, detail here. */}
        {data.type === 'node' && <NodeDetail data={data} embeddables={embeddables} />}

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
function NodeDetail({
  data,
  embeddables,
}: {
  data: InfoPanelData;
  embeddables?: Map<string, Attribute[]>;
}) {
  const info = buildNodeInfo(data.viewMode, data.attributes ?? [], data.constraints ?? [], embeddables);

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
