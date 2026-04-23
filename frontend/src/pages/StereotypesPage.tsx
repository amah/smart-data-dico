import { useState, useEffect } from 'react';
import { stereotypeApi } from '../services/api';
import type { Stereotype, StereotypeTarget } from '../types';
import StereotypeForm from '../components/StereotypeForm';

const TARGET_LABELS: Record<StereotypeTarget, string> = {
  entity: 'Entity Stereotypes',
  attribute: 'Attribute Stereotypes',
  package: 'Package Stereotypes',
  relationship: 'Relationship Stereotypes',
  model: 'Model Stereotypes',
};

export default function StereotypesPage() {
  const [stereotypes, setStereotypes] = useState<Stereotype[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const data = await stereotypeApi.getAll();
      setStereotypes(data);
    } catch (err) {
      setError('Failed to load stereotypes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async (data: Stereotype) => {
    try {
      await stereotypeApi.create(data);
      setShowCreate(false);
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.errors?.[0] || 'Failed to create');
    }
  };

  const handleUpdate = async (data: Stereotype) => {
    try {
      await stereotypeApi.update(data.id, data);
      setEditingId(null);
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.errors?.[0] || 'Failed to update');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete stereotype "${id}"?`)) return;
    try {
      await stereotypeApi.delete(id);
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.errors?.[0] || 'Failed to delete');
    }
  };

  const grouped = (['entity', 'attribute', 'package'] as StereotypeTarget[]).map((target) => ({
    target,
    label: TARGET_LABELS[target],
    items: stereotypes.filter((s) => s.appliesTo === target),
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Stereotypes</h1>
          <p className="text-base-content/70">Define metadata schemas for packages, entities, and attributes</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          Create Stereotype
        </button>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
          <button className="btn btn-ghost btn-xs" onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      {grouped.map(({ target, label, items }) => (
        <div key={target}>
          <h2 className="text-lg font-semibold mb-3">{label}</h2>
          {items.length === 0 ? (
            <p className="text-base-content/50 text-sm mb-4">No {target} stereotypes defined.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              {items.map((s) => (
                <div key={s.id} className="card bg-base-200 shadow-sm">
                  <div className="card-body p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-bold">{s.name}</h3>
                        <span className="badge badge-xs badge-outline">{s.id}</span>
                      </div>
                      <div className="flex gap-1">
                        <button className="btn btn-ghost btn-xs" onClick={() => setEditingId(s.id)}>Edit</button>
                        <button className="btn btn-ghost btn-xs text-error" onClick={() => handleDelete(s.id)}>&times;</button>
                      </div>
                    </div>
                    {s.description && <p className="text-sm text-base-content/70 mt-1">{s.description}</p>}
                    <div className="mt-2">
                      <span className="text-xs font-semibold">Fields ({s.metadataDefinitions.length}):</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.metadataDefinitions.map((d) => (
                          <span
                            key={d.name}
                            className={`badge badge-sm ${d.required ? 'badge-primary' : 'badge-ghost'}`}
                          >
                            {d.name}: {d.type}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Create Modal */}
      {showCreate && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <h3 className="font-bold text-lg">Create Stereotype</h3>
            <div className="mt-4">
              <StereotypeForm onSubmit={handleCreate} onCancel={() => setShowCreate(false)} />
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowCreate(false)}>close</button>
          </form>
        </dialog>
      )}

      {/* Edit Modal */}
      {editingId && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <h3 className="font-bold text-lg">Edit Stereotype</h3>
            <div className="mt-4">
              <StereotypeForm
                initialValues={stereotypes.find((s) => s.id === editingId)}
                onSubmit={handleUpdate}
                onCancel={() => setEditingId(null)}
                isEdit
              />
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setEditingId(null)}>close</button>
          </form>
        </dialog>
      )}
    </div>
  );
}
