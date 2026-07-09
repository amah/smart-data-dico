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
  /** Toggle the entity's hidden state (system.hidden, #hide-model-data). */
  onToggleHidden?: () => void;
  /** All package names, for the "Move to package" picker (#move-entity). */
  packages?: string[];
  /** Move this entity to another package. */
  onMoveEntity?: (targetPackage: string) => void;
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 760;
const DEFAULT_WIDTH = 320;

export default function CytoscapeInfoPanel({
  data, onClose, onNavigate, embeddables, styles, onApplyStyle, onCopyFormat, onPasteFormat, clipboard, onToggleHidden, packages, onMoveEntity,
}: CytoscapeInfoPanelProps) {
  const hasAppearance = !!(styles && styles.length > 0 && onApplyStyle);
  const moveTargets = (packages ?? []).filter((p) => p !== data.service);
  const canMove = !!onMoveEntity && moveTargets.length > 0;
  const showActionsMenu = data.type === 'node' && (hasAppearance || !!onToggleHidden || canMove);
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
        {/* Header — name, a compact "view details" icon, an Appearance menu, and
            close. Appearance is an infrequent action, so it lives behind a palette
            dropdown rather than a permanently-visible toolbar. */}
        <div className="flex items-center justify-between gap-1 mb-2">
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
          <div className="flex items-center gap-1 shrink-0">
            {/* Entity actions menu (palette dropdown): Appearance (#element-style)
                — style picker + copy/paste the format between entities — and the
                hide/unhide toggle (#hide-model-data). Infrequent, so tucked away. */}
            {showActionsMenu && (
              <div className="dropdown dropdown-end">
                <div
                  tabIndex={0}
                  role="button"
                  className="btn btn-ghost btn-xs btn-circle"
                  title="Entity actions"
                  aria-label="Entity actions"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2Z" />
                  </svg>
                </div>
                <div tabIndex={0} className="dropdown-content z-50 mt-1 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
                  {hasAppearance && (
                    <>
                      <div className="text-xs font-semibold mb-1.5 opacity-70">Appearance</div>
                      <select
                        className="select select-xs select-bordered w-full"
                        value={data.styleName ?? ''}
                        onChange={(e) => onApplyStyle!(e.target.value || null)}
                        title="Element style for this entity (persists as a non-destructive override)"
                      >
                        <option value="">Default (no explicit style)</option>
                        {styles!.map((s) => (
                          <option key={s.name} value={s.name}>{s.label || s.name}</option>
                        ))}
                      </select>
                      <div className="flex items-center gap-1 mt-2">
                        <button
                          className="btn btn-xs btn-ghost flex-1"
                          onClick={() => onCopyFormat?.(data.styleName ?? null)}
                          title="Copy this entity's style, then click other entities to paint it"
                        >
                          Copy format
                        </button>
                        <button
                          className="btn btn-xs btn-ghost flex-1"
                          onClick={() => onPasteFormat?.()}
                          disabled={clipboard == null}
                          title={clipboard == null
                            ? 'Nothing copied yet'
                            : `Apply the copied style (${clipboard === CLEAR_STYLE ? 'Default' : clipboard}) to this entity`}
                        >
                          Paste format
                        </button>
                      </div>
                    </>
                  )}
                  {onToggleHidden && (
                    <>
                      {hasAppearance && <div className="border-t border-base-300 my-2" />}
                      <button
                        className="btn btn-xs btn-ghost w-full justify-start gap-2"
                        onClick={onToggleHidden}
                        title={data.hidden
                          ? 'Show this entity again (clears system.hidden)'
                          : 'Hide this entity from lists & diagrams (non-destructive; sets system.hidden)'}
                      >
                        {data.hidden ? (
                          <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
                            </svg>
                            Unhide entity
                          </>
                        ) : (
                          <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20" />
                            </svg>
                            Hide entity
                          </>
                        )}
                      </button>
                    </>
                  )}
                  {canMove && (
                    <>
                      {(hasAppearance || onToggleHidden) && <div className="border-t border-base-300 my-2" />}
                      <div className="text-xs font-semibold mb-1.5 opacity-70">Move to package</div>
                      <select
                        className="select select-xs select-bordered w-full"
                        value=""
                        onChange={(e) => { if (e.target.value) onMoveEntity!(e.target.value); }}
                        title="Move this entity to another package (keeps its UUID, so references survive)"
                      >
                        <option value="">Choose package…</option>
                        {moveTargets.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              </div>
            )}
            <button onClick={onClose} className="btn btn-ghost btn-sm btn-circle">
              &times;
            </button>
          </div>
        </div>

        {/* Entity description, right below the header. */}
        {data.type === 'node' && data.description && (
          <p className="text-xs opacity-70 whitespace-pre-wrap mb-3">{data.description}</p>
        )}

        {/* Divider before the attribute/column detail. */}
        {data.type === 'node' && data.description && (
          <div className="border-b border-base-300 mb-3" />
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
