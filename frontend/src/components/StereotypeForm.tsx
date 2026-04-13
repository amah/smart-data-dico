import { useState } from 'react';
import type { Stereotype, MetadataDefinition, StereotypeTarget } from '../types';
import { MetadataValueType } from '../types';

interface StereotypeFormProps {
  initialValues?: Partial<Stereotype>;
  onSubmit: (data: Stereotype) => void;
  onCancel: () => void;
  isEdit?: boolean;
}

export default function StereotypeForm({ initialValues, onSubmit, onCancel, isEdit }: StereotypeFormProps) {
  const [id, setId] = useState(initialValues?.id || '');
  const [name, setName] = useState(initialValues?.name || '');
  const [description, setDescription] = useState(initialValues?.description || '');
  const [appliesTo, setAppliesTo] = useState<StereotypeTarget>(initialValues?.appliesTo || 'entity');
  const [definitions, setDefinitions] = useState<MetadataDefinition[]>(initialValues?.metadataDefinitions || []);

  const addDefinition = () => {
    setDefinitions([...definitions, { name: '', type: MetadataValueType.STRING }]);
  };

  const updateDefinition = (index: number, field: string, value: any) => {
    const updated = [...definitions];
    updated[index] = { ...updated[index], [field]: value };
    setDefinitions(updated);
  };

  const removeDefinition = (index: number) => {
    setDefinitions(definitions.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !name) return;
    onSubmit({ id, name, description, appliesTo, metadataDefinitions: definitions.filter((d) => d.name) });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="form-control">
          <label className="label"><span className="label-text">ID</span></label>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="kebab-case-id"
            disabled={isEdit}
            required
          />
        </div>
        <div className="form-control">
          <label className="label"><span className="label-text">Name</span></label>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display Name"
            required
          />
        </div>
      </div>

      <div className="form-control">
        <label className="label"><span className="label-text">Description</span></label>
        <textarea
          className="textarea textarea-bordered textarea-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>

      <div className="form-control">
        <label className="label"><span className="label-text">Applies To</span></label>
        <select
          className="select select-bordered select-sm"
          value={appliesTo}
          onChange={(e) => setAppliesTo(e.target.value as StereotypeTarget)}
        >
          <option value="entity">Entity</option>
          <option value="attribute">Attribute</option>
          <option value="package">Package</option>
          <option value="model">Model</option>
          <option value="relationship">Relationship</option>
        </select>
      </div>

      {/* Metadata Definitions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="label-text font-semibold">Metadata Definitions</label>
          <button type="button" className="btn btn-xs btn-primary" onClick={addDefinition}>
            Add Field
          </button>
        </div>

        <div className="space-y-2">
          {definitions.map((def, i) => (
            <div key={i} className="flex items-center gap-2 p-2 bg-base-200 rounded">
              <input
                type="text"
                className="input input-bordered input-xs w-32"
                value={def.name}
                onChange={(e) => updateDefinition(i, 'name', e.target.value)}
                placeholder="field-name"
              />
              <select
                className="select select-bordered select-xs"
                value={def.type}
                onChange={(e) => updateDefinition(i, 'type', e.target.value)}
              >
                {Object.values(MetadataValueType).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={def.required || false}
                  onChange={(e) => updateDefinition(i, 'required', e.target.checked)}
                />
                Required
              </label>
              <input
                type="text"
                className="input input-bordered input-xs flex-1"
                value={def.description || ''}
                onChange={(e) => updateDefinition(i, 'description', e.target.value)}
                placeholder="Description"
              />
              <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => removeDefinition(i)}>
                &times;
              </button>
            </div>
          ))}
          {definitions.length === 0 && (
            <p className="text-xs text-base-content/50 p-2">No metadata fields defined. Click "Add Field" above.</p>
          )}
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!id || !name}>
          {isEdit ? 'Update' : 'Create'}
        </button>
      </div>
    </form>
  );
}
