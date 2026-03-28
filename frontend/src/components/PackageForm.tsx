import { useState } from 'react';

interface PackageFormProps {
  initialValues?: {
    name?: string;
    description?: string;
    type?: string;
  };
  onSubmit: (data: { name: string; description: string; type: string }) => void;
  onCancel: () => void;
  isEdit?: boolean;
  loading?: boolean;
}

const PACKAGE_NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default function PackageForm({ initialValues, onSubmit, onCancel, isEdit, loading }: PackageFormProps) {
  const [name, setName] = useState(initialValues?.name || '');
  const [description, setDescription] = useState(initialValues?.description || '');
  const [type, setType] = useState(initialValues?.type || 'microservice');
  const [nameError, setNameError] = useState<string | null>(null);

  const handleNameChange = (value: string) => {
    setName(value);
    if (value && !PACKAGE_NAME_REGEX.test(value)) {
      setNameError('Must be kebab-case (lowercase, numbers, hyphens)');
    } else {
      setNameError(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || nameError) return;
    onSubmit({ name, description, type });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="form-control">
        <label className="label">
          <span className="label-text">Package Name</span>
        </label>
        <input
          type="text"
          className={`input input-bordered ${nameError ? 'input-error' : ''}`}
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="my-package"
          disabled={isEdit}
          required
        />
        {nameError && <label className="label"><span className="label-text-alt text-error">{nameError}</span></label>}
      </div>

      <div className="form-control">
        <label className="label">
          <span className="label-text">Description</span>
        </label>
        <textarea
          className="textarea textarea-bordered"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Package description..."
          rows={3}
        />
      </div>

      <div className="form-control">
        <label className="label">
          <span className="label-text">Type</span>
        </label>
        <select
          className="select select-bordered"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="project">Project</option>
          <option value="microservice">Microservice</option>
          <option value="module">Module</option>
        </select>
      </div>

      <div className="flex gap-2 justify-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!name || !!nameError || loading}
        >
          {loading && <span className="loading loading-spinner loading-sm" />}
          {isEdit ? 'Update' : 'Create'}
        </button>
      </div>
    </form>
  );
}
