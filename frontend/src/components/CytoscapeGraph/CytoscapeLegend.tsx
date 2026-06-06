import { useState } from 'react';
import type { ViewMode } from './viewMode';

interface CytoscapeLegendProps {
  serviceColorMap: Record<string, string>;
  showCaseStates?: boolean;
  viewMode?: ViewMode;
}

export default function CytoscapeLegend({
  serviceColorMap,
  showCaseStates = false,
  viewMode = 'structural',
}: CytoscapeLegendProps) {
  const [open, setOpen] = useState(true);

  const services = Object.entries(serviceColorMap);
  if (services.length === 0 && !showCaseStates && viewMode === 'structural') return null;

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
          {showCaseStates && (
            <>
              <li className="flex items-center gap-2">
                <LegendSwatch borderStyle="double" customColor="#e74c3c" />
                <span>Case root</span>
              </li>
              <li className="flex items-center gap-2">
                <LegendSwatch customColor="#2ecc71" />
                <span>Case member</span>
              </li>
              <li className="flex items-center gap-2">
                <LegendSwatch borderStyle="dashed" customColor="#f39c12" />
                <span>Case frontier</span>
              </li>
            </>
          )}
        </ul>
      </div>

      {viewMode === 'logical' && (
        <div className="px-3 py-2 border-t border-base-300">
          <div className="opacity-60 mb-1">Edges</div>
          <ul className="space-y-1">
            <li className="flex items-center gap-2">
              <LegendLine />
              <span>Association (fetch / cascade)</span>
            </li>
            <li className="flex items-center gap-2">
              <LegendLine arrow="▷" />
              <span>Inheritance (is-a)</span>
            </li>
          </ul>
        </div>
      )}

      {viewMode === 'physical' && (
        <div className="px-3 py-2 border-t border-base-300">
          <div className="opacity-60 mb-1">Drift</div>
          <ul className="space-y-1">
            <li className="flex items-center gap-2">
              <LegendLine dashed customColor="#f59e0b" />
              <span>Not enforced in DB (relationship, no FK)</span>
            </li>
            <li className="flex items-center gap-2">
              <LegendLine dashed arrow="▸" customColor="#f59e0b" />
              <span>In DB, missing from model (FK, no relationship)</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

function LegendLine({
  dashed = false,
  customColor,
  arrow,
}: {
  dashed?: boolean;
  customColor?: string;
  arrow?: string;
}) {
  return (
    <span className="inline-flex items-center" style={{ width: 16 }}>
      <span
        className="inline-block"
        style={{
          width: 14,
          borderTopWidth: 2,
          borderTopStyle: dashed ? 'dashed' : 'solid',
          borderTopColor: customColor ?? 'currentColor',
        }}
      />
      {arrow && <span style={{ color: customColor, fontSize: 10, lineHeight: 1 }}>{arrow}</span>}
    </span>
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
