import { useState } from 'react';
import { Cardinality } from '../../types';

interface CreateRelationshipModalProps {
  sourceLabel: string;
  targetLabel: string;
  onConfirm: (data: {
    description: string;
    sourceCardinality: Cardinality;
    targetCardinality: Cardinality;
    sourceName: string;
    targetName: string;
  }) => void;
  onCancel: () => void;
}

/**
 * Derive a default navigation property name from an entity name +
 * cardinality. E.g. "OrderItem" + many → "orderItems", "Order" + one → "order".
 */
function defaultEndName(entityName: string, cardinality: Cardinality): string {
  const camel = entityName.charAt(0).toLowerCase() + entityName.slice(1);
  return cardinality === Cardinality.MANY ? camel + 's' : camel;
}

export default function CreateRelationshipModal({
  sourceLabel,
  targetLabel,
  onConfirm,
  onCancel,
}: CreateRelationshipModalProps) {
  const [description, setDescription] = useState(`${sourceLabel} to ${targetLabel}`);
  const [sourceCard, setSourceCard] = useState<Cardinality>(Cardinality.ONE);
  const [targetCard, setTargetCard] = useState<Cardinality>(Cardinality.MANY);
  // End names: the navigation property name FROM the opposite entity's perspective.
  // source.name = what the target calls the source (e.g. OrderItem calls Order "order")
  // target.name = what the source calls the target (e.g. Order calls OrderItem "items")
  const [sourceName, setSourceName] = useState(defaultEndName(sourceLabel, Cardinality.ONE));
  const [targetName, setTargetName] = useState(defaultEndName(targetLabel, Cardinality.MANY));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm({
      description,
      sourceCardinality: sourceCard,
      targetCardinality: targetCard,
      sourceName: sourceName.trim(),
      targetName: targetName.trim(),
    });
  };

  return (
    <dialog className="modal modal-open" style={{ zIndex: 9999 }}>
      <div className="modal-box max-w-md">
        <h3 className="font-bold text-lg">Create Relationship</h3>
        <p className="text-sm text-base-content/70 mt-1">
          <span className="font-mono font-bold">{sourceLabel}</span>
          {' → '}
          <span className="font-mono font-bold">{targetLabel}</span>
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="form-control">
            <label className="label"><span className="label-text">Description</span></label>
            <input
              type="text"
              className="input input-bordered"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              autoFocus
            />
          </div>

          {/* Endpoint names */}
          <div className="grid grid-cols-2 gap-4">
            <div className="form-control">
              <label className="label">
                <span className="label-text">
                  From {targetLabel} as...
                </span>
              </label>
              <input
                type="text"
                className="input input-bordered input-sm font-mono"
                placeholder={defaultEndName(sourceLabel, sourceCard)}
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
              />
              <label className="label py-0">
                <span className="label-text-alt text-base-content/50">
                  e.g. "{targetLabel}.{sourceName || '...'}"
                </span>
              </label>
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text">
                  From {sourceLabel} as...
                </span>
              </label>
              <input
                type="text"
                className="input input-bordered input-sm font-mono"
                placeholder={defaultEndName(targetLabel, targetCard)}
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
              />
              <label className="label py-0">
                <span className="label-text-alt text-base-content/50">
                  e.g. "{sourceLabel}.{targetName || '...'}"
                </span>
              </label>
            </div>
          </div>

          {/* Cardinality */}
          <div className="grid grid-cols-2 gap-4">
            <div className="form-control">
              <label className="label"><span className="label-text">{sourceLabel} cardinality</span></label>
              <select
                className="select select-bordered"
                value={sourceCard}
                onChange={(e) => {
                  const c = e.target.value as Cardinality;
                  setSourceCard(c);
                  if (sourceName === defaultEndName(sourceLabel, sourceCard)) {
                    setSourceName(defaultEndName(sourceLabel, c));
                  }
                }}
              >
                <option value={Cardinality.ONE}>One</option>
                <option value={Cardinality.MANY}>Many</option>
              </select>
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text">{targetLabel} cardinality</span></label>
              <select
                className="select select-bordered"
                value={targetCard}
                onChange={(e) => {
                  const c = e.target.value as Cardinality;
                  setTargetCard(c);
                  if (targetName === defaultEndName(targetLabel, targetCard)) {
                    setTargetName(defaultEndName(targetLabel, c));
                  }
                }}
              >
                <option value={Cardinality.ONE}>One</option>
                <option value={Cardinality.MANY}>Many</option>
              </select>
            </div>
          </div>

          <div className="text-center text-sm text-base-content/60 font-mono">
            {sourceLabel}.{targetName || '?'} ({sourceCard}) → ({targetCard}) {targetLabel}.{sourceName || '?'}
          </div>

          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create</button>
          </div>
        </form>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onCancel}>close</button>
      </form>
    </dialog>
  );
}
