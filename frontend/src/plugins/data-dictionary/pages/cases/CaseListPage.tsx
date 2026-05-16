import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useService } from '../../../../kernel/useService';
import { CASE_SERVICE_TOKEN } from '../../../../kernel/tokens';
import type { CaseService } from '../../services/CaseService';
import type { Case } from '../../../../types';

export default function CaseListPage() {
  const caseService = useService<CaseService>(CASE_SERVICE_TOKEN);
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    caseService.getAll().then(setCases).catch(() => {}).finally(() => setLoading(false));
  }, [caseService]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><span className="loading loading-spinner loading-lg" /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cases</h1>
          <p className="text-base-content/70">Business views over the data model</p>
        </div>
        <Link to="/cases/create" className="btn btn-primary btn-sm">Create Case</Link>
      </div>

      {cases.length === 0 ? (
        <div className="text-center py-12 text-base-content/50">
          <p className="text-lg">No cases defined yet.</p>
          <p className="text-sm mt-1">Create one to define a business view over your data model.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cases.map((c) => (
            <Link key={c.uuid} to={`/cases/${c.uuid}`} className="card bg-base-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="card-body p-5">
                <h3 className="card-title text-lg">{c.name}</h3>
                {c.description && <p className="text-sm text-base-content/70 line-clamp-2">{c.description}</p>}
                <div className="flex gap-3 text-xs text-base-content/60 mt-2">
                  <span>{c.rootEntities.length} root{c.rootEntities.length !== 1 ? 's' : ''}</span>
                  <span>{c.nodes?.length || 0} annotations</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
