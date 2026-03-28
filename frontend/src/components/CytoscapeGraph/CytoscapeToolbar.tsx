import { useState } from 'react';
import type { Core } from 'cytoscape';
import type { LayoutName, LayoutDirection } from './CytoscapeGraph.types';
import type { DiagramLayout } from '../../types';

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
    const cy = cyRef.current;
    if (cy) cy.fit(undefined, 40);
  };

  const handleExportPng = () => {
    const cy = cyRef.current;
    if (!cy) return;
    const png = cy.png({ full: true, scale: 2, bg: 'white' });
    const link = document.createElement('a');
    link.href = png;
    link.download = 'graph.png';
    link.click();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-2 bg-base-200 rounded-t-lg border-b border-base-300">
      {/* Layout */}
      <div className="join">
        <button
          className={`join-item btn btn-xs ${layoutName === 'dagre' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => onLayoutChange('dagre')}
          title="Hierarchical layout"
        >
          Dagre
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
      {layoutName === 'dagre' && (
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

      <div className="divider divider-horizontal mx-0 h-6" />

      {/* Zoom */}
      <div className="join">
        <button className="join-item btn btn-xs btn-ghost" onClick={handleZoomIn} title="Zoom in">+</button>
        <button className="join-item btn btn-xs btn-ghost" onClick={handleZoomOut} title="Zoom out">-</button>
        <button className="join-item btn btn-xs btn-ghost" onClick={handleFit} title="Fit to screen">Fit</button>
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
      <button className="btn btn-xs btn-ghost ml-auto" onClick={handleExportPng} title="Export as PNG">
        Export PNG
      </button>
    </div>
  );
}
