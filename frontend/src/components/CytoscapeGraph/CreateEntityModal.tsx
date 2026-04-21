import { useEffect, useState } from 'react';
import type { Stereotype } from '../../types';
import { stereotypeApi } from '../../services/api';

interface CreateEntityModalProps {
  /** Pre-selected package. If only one option, selector is disabled. */
  packageOptions: string[];
  defaultPackage: string;
  onConfirm: (data: { packageName: string; name: string; description: string; stereotype?: string }) => void;
  onCancel: () => void;
}

export default function CreateEntityModal({
  packageOptions,
  defaultPackage,
  onConfirm,
  onCancel,
}: CreateEntityModalProps) {
  const [packageName, setPackageName] = useState(defaultPackage || packageOptions[0] || '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stereotype, setStereotype] = useState<string>('');
  const [stereotypes, setStereotypes] = useState<Stereotype[]>([]);

  useEffect(() => {
    stereotypeApi.getAll('entity').then(setStereotypes).catch(() => {});
  }, []);

  const trimmedName = name.trim();
  const canSubmit = !!packageName && !!trimmedName;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onConfirm({
      packageName,
      name: trimmedName,
      description: description.trim(),
      stereotype: stereotype || undefined,
    });
  };

  const onlyOnePackage = packageOptions.length <= 1;

  return (
    <dialog className="modal modal-open" style={{ zIndex: 9999 }}>
      <div className="modal-box max-w-md">
        <h3 className="font-bold text-lg">Create Entity</h3>
        <p className="text-sm text-base-content/70 mt-1">
          Attribute editing happens on the entity details page after creation.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="form-control">
            <label className="label"><span className="label-text">Package</span></label>
            <select
              className="select select-bordered"
              value={packageName}
              onChange={(e) => setPackageName(e.target.value)}
              disabled={onlyOnePackage}
            >
              {packageOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="form-control">
            <label className="label"><span className="label-text">Name *</span></label>
            <input
              type="text"
              className="input input-bordered font-mono"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Customer"
              autoFocus
              required
            />
          </div>

          <div className="form-control">
            <label className="label"><span className="label-text">Description</span></label>
            <textarea
              className="textarea textarea-bordered"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="form-control">
            <label className="label"><span className="label-text">Stereotype</span></label>
            <select
              className="select select-bordered"
              value={stereotype}
              onChange={(e) => setStereotype(e.target.value)}
            >
              <option value="">(none)</option>
              {stereotypes.map((s) => (
                <option key={s.id} value={s.id}>{s.id}</option>
              ))}
            </select>
          </div>

          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>Create</button>
          </div>
        </form>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onCancel}>close</button>
      </form>
    </dialog>
  );
}
