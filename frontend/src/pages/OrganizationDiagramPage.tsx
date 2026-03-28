import React, { useState, useEffect } from 'react';
import CytoscapeGraph from '../components/CytoscapeGraph';
import { entityApi } from '../services/api';
import type { Package } from '../types';

const OrganizationDiagramPage: React.FC = () => {
  const [packages, setPackages] = useState<Package[]>([]);

  useEffect(() => {
    const fetchPackages = async () => {
      try {
        const pkgs = await entityApi.getAllPackages();
        setPackages(pkgs || []);
      } catch (err) {
        console.error('Error fetching packages:', err);
      }
    };
    fetchPackages();
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="bg-base-200 border-b border-base-300 px-4 py-2">
        <h1 className="text-xl font-bold">Organization Diagram</h1>
        <p className="text-xs text-base-content/70">
          Cross-package entity relationship graph
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <CytoscapeGraph mode="organization" packages={packages} />
      </div>
    </div>
  );
};

export default OrganizationDiagramPage;
