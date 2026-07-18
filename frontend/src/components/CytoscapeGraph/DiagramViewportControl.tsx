import type { Core } from 'cytoscape';
import { recenterDiagram } from './diagramViewport';

interface DiagramViewportControlProps {
  cyRef: React.RefObject<Core | null>;
}

/** Always-visible recovery action when the model has been panned out of view. */
export default function DiagramViewportControl({ cyRef }: DiagramViewportControlProps) {
  return (
    <button
      type="button"
      className="absolute right-2 top-2 z-30 btn btn-sm bg-base-100 border-base-300 shadow-md"
      onClick={() => recenterDiagram(cyRef.current)}
      aria-label="Recenter diagram"
      title="Recenter and fit the model in the viewport"
    >
      <span aria-hidden="true">⌖</span>
      Recenter
    </button>
  );
}
