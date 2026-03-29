import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { perspectiveApi } from '../services/api';
import type { Perspective } from '../types';

export default function PerspectiveListPage() {
  const [perspectives, setPerspectives] = useState<Perspective[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    perspectiveApi.getAll().then(setPerspectives).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><span className="loading loading-spinner loading-lg" /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Perspectives</h1>
          <p className="text-base-content/70">Business views over the data model</p>
        </div>
        <Link to="/perspectives/create" className="btn btn-primary btn-sm">Create Perspective</Link>
      </div>

      {perspectives.length === 0 ? (
        <div className="text-center py-12 text-base-content/50">
          <p className="text-lg">No perspectives defined yet.</p>
          <p className="text-sm mt-1">Create one to define a business view over your data model.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {perspectives.map((p) => (
            <Link key={p.uuid} to={`/perspectives/${p.uuid}`} className="card bg-base-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="card-body p-5">
                <h3 className="card-title text-lg">{p.name}</h3>
                {p.description && <p className="text-sm text-base-content/70 line-clamp-2">{p.description}</p>}
                <div className="flex gap-3 text-xs text-base-content/60 mt-2">
                  <span>{p.rootEntities.length} root{p.rootEntities.length !== 1 ? 's' : ''}</span>
                  <span>{p.nodes?.length || 0} annotations</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
