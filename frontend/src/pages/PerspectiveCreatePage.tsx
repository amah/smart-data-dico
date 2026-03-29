import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { perspectiveApi } from '../services/api';
import PerspectiveEntityPicker from '../components/PerspectiveEntityPicker';
import MetadataEditor from '../components/MetadataEditor';
import type { MetadataEntry } from '../types';

export default function PerspectiveCreatePage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rootEntities, setRootEntities] = useState<string[]>([]);
  const [maxDepth, setMaxDepth] = useState(10);
  const [metadata, setMetadata] = useState<MetadataEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!isEdit);

  // Load existing perspective for edit mode
  if (isEdit && !loaded) {
    perspectiveApi.getById(id).then((p) => {
      setName(p.name);
      setDescription(p.description || '');
      setRootEntities(p.rootEntities);
      setMaxDepth(p.maxDepth ?? 10);
      setMetadata(p.metadata || []);
      setLoaded(true);
    }).catch(() => { setError('Failed to load perspective'); setLoaded(true); });
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || rootEntities.length === 0) {
      setError('Name and at least one root entity are required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await perspectiveApi.update(id, { name, description, rootEntities, maxDepth, metadata });
        navigate(`/perspectives/${id}`);
      } else {
        const result = await perspectiveApi.create({ name, description, rootEntities, maxDepth, metadata });
        navigate(`/perspectives/${result.data.uuid}`);
      }
    } catch (err: any) {
      setError(err.response?.data?.errors?.[0] || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return <div className="flex items-center justify-center h-64"><span className="loading loading-spinner loading-lg" /></div>;
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">{isEdit ? 'Edit' : 'Create'} Perspective</h1>

      {error && <div className="alert alert-error mb-4"><span>{error}</span></div>}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="form-control">
          <label className="label"><span className="label-text">Name</span></label>
          <input
            type="text"
            className="input input-bordered"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ordering, Billing"
            required
          />
        </div>

        <div className="form-control">
          <label className="label"><span className="label-text">Description</span></label>
          <textarea
            className="textarea textarea-bordered"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What business process does this perspective capture?"
            rows={3}
          />
        </div>

        <div className="form-control">
          <label className="label"><span className="label-text">Max Traversal Depth</span></label>
          <input
            type="number"
            className="input input-bordered w-24"
            value={maxDepth}
            onChange={(e) => setMaxDepth(Number(e.target.value))}
            min={1}
            max={20}
          />
          <label className="label"><span className="label-text-alt">How many relationship hops to follow from root entities</span></label>
        </div>

        <div className="form-control">
          <label className="label"><span className="label-text">Root Entities</span></label>
          <PerspectiveEntityPicker selected={rootEntities} onChange={setRootEntities} />
        </div>

        <div className="form-control">
          <label className="label"><span className="label-text">Perspective Metadata</span></label>
          <MetadataEditor entries={metadata} onChange={setMetadata} />
        </div>

        <div className="flex gap-2 justify-end pt-4">
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/perspectives')}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !name || rootEntities.length === 0}>
            {saving && <span className="loading loading-spinner loading-sm" />}
            {isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
