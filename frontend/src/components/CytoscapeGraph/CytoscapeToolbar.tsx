import { useState } from 'react';
import type { Core } from 'cytoscape';
import type { LayoutName, LayoutDirection } from './CytoscapeGraph.types';
import type { DiagramLayout } from '../../types';
import type { ElementStyle } from '../../utils/elementStyle';
import { CLEAR_STYLE, type FormatPainter } from './useFormatPainter';
import { recenterDiagram } from './diagramViewport';

interface CytoscapeToolbarProps {
  cyRef: React.RefObject<Core | null>;
  layoutName: LayoutName;
  layoutDirection: LayoutDirection;
  onLayoutChange: (name: LayoutName) => void;
  onDirectionChange: (dir: LayoutDirection) => void;
  onRunLayout: () => void;
  onSearch: (query: string) => void;
  // Persistence
  layouts: DiagramLayout[];
  onSaveLayout: (name: string) => void;
  onLoadLayout: (id: string) => void;
  onDeleteLayout: (id: string) => void;
  // Export filename base (e.g. service/package name). Falls back to "diagram".
  exportFilenameBase?: string;
  // When provided, adds a "+" button that opens the create-entity modal.
  onAddEntity?: () => void;
  // Logical view: optional ORM-annotation toggle (only rendered when the
  // handler is provided, i.e. in the logical view).
  ormAnnotations?: boolean;
  onToggleOrmAnnotations?: () => void;
  // Format painter (#element-style) — style entities from the diagram.
  painter?: FormatPainter;
  styles?: ElementStyle[];
}

export default function CytoscapeToolbar({
  cyRef,
  layoutName,
  layoutDirection,
  onLayoutChange,
  onDirectionChange,
  onRunLayout,
  onSearch,
  layouts,
  onSaveLayout,
  onLoadLayout,
  onDeleteLayout,
  exportFilenameBase,
  onAddEntity,
  ormAnnotations,
  onToggleOrmAnnotations,
  painter,
  styles = [],
}: CytoscapeToolbarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [layoutNameInput, setLayoutNameInput] = useState('');

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    onSearch(value);
  };

  const handleSave = () => {
    if (layoutNameInput.trim()) {
      onSaveLayout(layoutNameInput.trim());
      setLayoutNameInput('');
      setShowSaveDialog(false);
    }
  };

  const handleZoomIn = () => {
    const cy = cyRef.current;
    if (cy) cy.zoom({ level: cy.zoom() * 1.2, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };

  const handleZoomOut = () => {
    const cy = cyRef.current;
    if (cy) cy.zoom({ level: cy.zoom() / 1.2, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };

  const handleFit = () => {
    recenterDiagram(cyRef.current);
  };

  const filenameBase = (exportFilenameBase || 'diagram').replace(/[^a-z0-9-_]/gi, '_');

  const handleExportPng = () => {
    const cy = cyRef.current;
    if (!cy) return;
    const png = cy.png({ full: true, scale: 2, bg: 'white' });
    const link = document.createElement('a');
    link.href = png;
    link.download = `${filenameBase}.png`;
    link.click();
  };

  const handleExportSvg = () => {
    const cy = cyRef.current as (Core & { svg?: (opts?: { full?: boolean; bg?: string }) => string }) | null;
    if (!cy || typeof cy.svg !== 'function') return;
    const svg = cy.svg({ full: true, bg: 'white' });
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filenameBase}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-2 bg-base-200 rounded-t-lg border-b border-base-300">
      {/* Layout */}
      <div className="join">
        <button
          className={`join-item btn btn-xs ${layoutName === 'dagre' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => onLayoutChange('dagre')}
          title="Hierarchical layout (Dagre)"
        >
          Dagre
        </button>
        <button
          className={`join-item btn btn-xs ${layoutName === 'elk' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => onLayoutChange('elk')}
          title="Structured layout with orthogonal edges (ELK)"
        >
          ELK
        </button>
        <button
          className={`join-item btn btn-xs ${layoutName === 'fcose' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => onLayoutChange('fcose')}
          title="Force-directed layout"
        >
          Force
        </button>
      </div>

      {/* Direction */}
      {(layoutName === 'dagre' || layoutName === 'elk') && (
        <div className="join">
          {(['TB', 'LR', 'BT', 'RL'] as LayoutDirection[]).map((dir) => (
            <button
              key={dir}
              className={`join-item btn btn-xs ${layoutDirection === dir ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => onDirectionChange(dir)}
            >
              {dir}
            </button>
          ))}
        </div>
      )}

      <button className="btn btn-xs btn-ghost" onClick={onRunLayout} title="Re-run layout">
        Re-layout
      </button>

      {onToggleOrmAnnotations && (
        <button
          className={`btn btn-xs ${ormAnnotations ? 'btn-primary' : 'btn-ghost'}`}
          onClick={onToggleOrmAnnotations}
          title="Show ORM annotations (fetch / cascade / orphanRemoval) on association edges"
        >
          ORM details
        </button>
      )}

      {onAddEntity && (
        <button
          className="btn btn-xs btn-primary"
          onClick={onAddEntity}
          title="Add entity (or right-click empty canvas)"
        >
          + Entity
        </button>
      )}

      {/* Format painter — copy a style from an entity (info panel) or paint with the
          clipboard style: click the brush (once = one target, double-click = keep on),
          then click entities. Esc / Done stops. */}
      {painter && (() => {
        const clip = painter.clipboard;
        const clipLabel = clip === null ? ''
          : clip === CLEAR_STYLE ? 'Default'
          : (styles.find((s) => s.name === clip)?.label || clip);
        const empty = clip === null;
        return (
          <div className="flex items-center gap-1">
            <button
              className={`btn btn-xs ${painter.armed ? 'btn-primary' : 'btn-ghost'}`}
              onClick={painter.toggle}
              onDoubleClick={painter.armSticky}
              disabled={empty}
              title={empty
                ? 'Copy a style first — select an entity, then “Copy format” in its panel'
                : painter.armed
                  ? `Painting «${clipLabel}»${painter.sticky ? ' (keep on — Esc to stop)' : ' — click an entity'}. Double-click to keep on.`
                  : `Paint «${clipLabel}» — click the brush then click entities (double-click = keep on)`}
            >
              🖌 {painter.armed ? (painter.sticky ? 'Painting…' : 'Paint') : 'Format'}
              {clipLabel && `: ${clipLabel}`}
            </button>
            {painter.armed && (
              <button className="btn btn-xs btn-ghost" onClick={painter.disarm} title="Stop painting (Esc)">
                Done
              </button>
            )}
          </div>
        );
      })()}

      <div className="divider divider-horizontal mx-0 h-6" />

      {/* Zoom */}
      <div className="join">
        <button className="join-item btn btn-xs btn-ghost" onClick={handleZoomIn} title="Zoom in">+</button>
        <button className="join-item btn btn-xs btn-ghost" onClick={handleZoomOut} title="Zoom out">-</button>
        <button className="join-item btn btn-xs btn-ghost" onClick={handleFit} title="Recenter and fit the model">Recenter</button>
      </div>

      <div className="divider divider-horizontal mx-0 h-6" />

      {/* Search */}
      <input
        type="text"
        className="input input-xs input-bordered w-40"
        placeholder="Search nodes..."
        value={searchQuery}
        onChange={(e) => handleSearch(e.target.value)}
      />

      <div className="divider divider-horizontal mx-0 h-6" />

      {/* Save / Load */}
      <div className="dropdown dropdown-end">
        <label tabIndex={0} className="btn btn-xs btn-ghost">
          Layouts ({layouts.length})
        </label>
        <div
          tabIndex={0}
          className="dropdown-content z-50 menu p-2 shadow bg-base-100 rounded-box w-52"
        >
          {layouts.map((l) => (
            <div key={l.id} className="flex items-center gap-1">
              <button
                className="btn btn-xs btn-ghost flex-1 justify-start"
                onClick={() => onLoadLayout(l.id)}
              >
                {l.name}
              </button>
              <button
                className="btn btn-xs btn-ghost text-error"
                onClick={() => onDeleteLayout(l.id)}
              >
                &times;
              </button>
            </div>
          ))}
          {layouts.length === 0 && (
            <div className="text-xs opacity-50 px-2 py-1">No saved layouts</div>
          )}
        </div>
      </div>

      {showSaveDialog ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            className="input input-xs input-bordered w-28"
            placeholder="Layout name"
            value={layoutNameInput}
            onChange={(e) => setLayoutNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            autoFocus
          />
          <button className="btn btn-xs btn-primary" onClick={handleSave}>Save</button>
          <button className="btn btn-xs btn-ghost" onClick={() => setShowSaveDialog(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn btn-xs btn-ghost" onClick={() => setShowSaveDialog(true)}>
          Save Layout
        </button>
      )}

      {/* Export */}
      <div className="dropdown dropdown-end ml-auto">
        <label tabIndex={0} className="btn btn-xs btn-ghost" title="Export diagram">
          Export
        </label>
        <ul
          tabIndex={0}
          className="dropdown-content z-50 menu p-1 shadow bg-base-100 rounded-box w-36 text-sm"
        >
          <li>
            <button className="justify-start" onClick={handleExportPng}>
              PNG
            </button>
          </li>
          <li>
            <button className="justify-start" onClick={handleExportSvg}>
              SVG
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
