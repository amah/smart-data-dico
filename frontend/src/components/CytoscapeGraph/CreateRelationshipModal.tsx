import { useState } from 'react';
import { Cardinality } from '../../types';

interface CreateRelationshipModalProps {
  sourceLabel: string;
  targetLabel: string;
  onConfirm: (data: {
    description: string;
    sourceCardinality: Cardinality;
    targetCardinality: Cardinality;
  }) => void;
  onCancel: () => void;
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm({
      description,
      sourceCardinality: sourceCard,
      targetCardinality: targetCard,
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

          <div className="grid grid-cols-2 gap-4">
            <div className="form-control">
              <label className="label"><span className="label-text">{sourceLabel} cardinality</span></label>
              <select
                className="select select-bordered"
                value={sourceCard}
                onChange={(e) => setSourceCard(e.target.value as Cardinality)}
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
                onChange={(e) => setTargetCard(e.target.value as Cardinality)}
              >
                <option value={Cardinality.ONE}>One</option>
                <option value={Cardinality.MANY}>Many</option>
              </select>
            </div>
          </div>

          <div className="text-center text-sm text-base-content/60">
            {sourceLabel} ({sourceCard}) → ({targetCard}) {targetLabel}
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
