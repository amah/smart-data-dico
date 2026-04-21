import { useState } from 'react';

interface CytoscapeLegendProps {
  serviceColorMap: Record<string, string>;
  showPerspectiveStates?: boolean;
}

export default function CytoscapeLegend({
  serviceColorMap,
  showPerspectiveStates = false,
}: CytoscapeLegendProps) {
  const [open, setOpen] = useState(true);

  const services = Object.entries(serviceColorMap);
  if (services.length === 0 && !showPerspectiveStates) return null;

  if (!open) {
    return (
      <div className="absolute bottom-2 left-2 z-30">
        <button
          className="btn btn-xs btn-ghost bg-base-100 border border-base-300 shadow-sm"
          onClick={() => setOpen(true)}
          title="Show legend"
        >
          Legend
        </button>
      </div>
    );
  }

  return (
    <div className="absolute bottom-2 left-2 z-30 bg-base-100 border border-base-300 rounded-lg shadow-md text-xs max-w-[240px]">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="font-semibold uppercase tracking-wide opacity-70">Legend</span>
        <button
          onClick={() => setOpen(false)}
          className="btn btn-ghost btn-xs btn-circle"
          title="Hide legend"
        >
          &times;
        </button>
      </div>

      {services.length > 0 && (
        <div className="px-3 py-2 border-t border-base-300">
          <div className="opacity-60 mb-1">Packages</div>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {services.map(([name, color]) => (
              <li key={name} className="flex items-center gap-2">
                <span
                  className="inline-block w-3 h-3 rounded-sm border border-base-300"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate">{name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-3 py-2 border-t border-base-300">
        <div className="opacity-60 mb-1">Indicators</div>
        <ul className="space-y-1">
          <li className="flex items-center gap-2">
            <LegendSwatch borderClass="border-primary" />
            <span>Has primary key</span>
          </li>
          {showPerspectiveStates && (
            <>
              <li className="flex items-center gap-2">
                <LegendSwatch borderStyle="double" customColor="#e74c3c" />
                <span>Perspective root</span>
              </li>
              <li className="flex items-center gap-2">
                <LegendSwatch customColor="#2ecc71" />
                <span>Perspective member</span>
              </li>
              <li className="flex items-center gap-2">
                <LegendSwatch borderStyle="dashed" customColor="#f39c12" />
                <span>Perspective frontier</span>
              </li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}

function LegendSwatch({
  borderClass,
  borderStyle = 'solid',
  customColor,
}: {
  borderClass?: string;
  borderStyle?: 'solid' | 'dashed' | 'double';
  customColor?: string;
}) {
  return (
    <span
      className={`inline-block w-4 h-4 rounded-sm bg-base-100 ${borderClass ?? ''}`}
      style={{
        borderStyle,
        borderWidth: borderStyle === 'double' ? 3 : 2,
        borderColor: customColor,
      }}
    />
  );
}
