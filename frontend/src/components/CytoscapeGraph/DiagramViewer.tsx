/**
 * DiagramViewer — the single diagram viewer used everywhere a diagram canvas
 * is shown: the standalone /diagram page and the package Diagram view.
 *
 * Owns the Structural/Physical mode (sticky via the shared `sdd-diagram-view`
 * preference), renders the tab strip and the full-height bordered canvas.
 * With `syncViewToUrl`, an explicit `?view=` URL param wins over the stored
 * preference and tab clicks write it back (the default mode is omitted to
 * keep the URL clean) — only the /diagram page does this; the package view
 * already uses `?view=` for its own List/Diagram toggle.
 */
import { useSearchParams } from 'react-router-dom';
import CytoscapeGraph from './CytoscapeGraph';
import DiagramViewTabs from './DiagramViewTabs';
import { DEFAULT_VIEW_MODE, isViewMode, type ViewMode } from './viewMode';
import { useStoredState } from '../../hooks/useStoredState';
import type { GraphMode } from './CytoscapeGraph.types';
import { SagaDiagram } from '../../plugins/data-dictionary/components/saga/SagaDiagram';

interface DiagramViewerProps {
  service?: string;
  mode?: GraphMode;
  caseId?: string;
  syncViewToUrl?: boolean;
}

const DiagramViewer = ({ service, mode, caseId, syncViewToUrl = false }: DiagramViewerProps) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [storedView, setStoredView] = useStoredState('sdd-diagram-view', DEFAULT_VIEW_MODE, isViewMode);
  const urlView = syncViewToUrl ? searchParams.get('view') : null;
  const viewMode: ViewMode = urlView && isViewMode(urlView) ? urlView : storedView;

  const setViewMode = (next: ViewMode) => {
    setStoredView(next);
    if (!syncViewToUrl) return;
    const params = new URLSearchParams(searchParams);
    if (next === DEFAULT_VIEW_MODE) params.delete('view');
    else params.set('view', next);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <DiagramViewTabs value={viewMode} onChange={setViewMode} />
      <div
        className="flex-1 min-h-0 border border-base-300 overflow-hidden"
        style={{ borderRadius: '0 0 var(--radius-md) var(--radius-md)' }}
      >
        {viewMode === 'process' ? (
          <SagaDiagram service={service} />
        ) : (
          <CytoscapeGraph service={service} mode={mode} viewMode={viewMode} caseId={caseId} />
        )}
      </div>
    </div>
  );
};

export default DiagramViewer;
