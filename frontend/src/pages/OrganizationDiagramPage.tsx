import { useState, useEffect } from 'react';
import { entityApi } from '../services/api';
import type { Package } from '../types';
import CytoscapeGraph from '../components/CytoscapeGraph';

export default function OrganizationDiagramPage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    entityApi
      .getAllPackages()
      .then(setPackages)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold">Diagram</h1>
          <p className="text-base-content/60 text-sm">
            All entities and relationships across {packages.length} packages
          </p>
        </div>
      </div>
      <div className="flex-1 min-h-0 border border-base-300 rounded-lg overflow-hidden">
        <CytoscapeGraph mode="organization" packages={packages} />
      </div>
    </div>
  );
}
