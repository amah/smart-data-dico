import type { TooltipData } from './CytoscapeGraph.types';

interface CytoscapeTooltipProps {
  data: TooltipData;
}

export default function CytoscapeTooltip({ data }: CytoscapeTooltipProps) {
  return (
    <div
      className="absolute z-50 pointer-events-none bg-base-200 border border-base-300 rounded-lg shadow-lg px-3 py-2 text-sm max-w-xs"
      style={{
        left: data.position.x,
        top: data.position.y,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <div className="font-bold text-base-content">{data.label}</div>
      {data.service && (
        <div className="text-xs opacity-60">{data.service}</div>
      )}
      {data.description && (
        <div className="mt-1 text-xs text-base-content/80 line-clamp-2">
          {data.description}
        </div>
      )}
      <div className="mt-1 flex gap-2 text-xs opacity-70">
        <span>{data.attrCount} attributes</span>
        {data.pkCount > 0 && <span>{data.pkCount} PK</span>}
      </div>
    </div>
  );
}
