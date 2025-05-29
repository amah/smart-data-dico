import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { getAllPackageHierarchies } from '../services/api';
import { Entity, Package } from '../types';
import OrganizationDiagramEditor from './OrganizationDiagramEditor';
import EntityFlatTable from './EntityFlatTable';

type ViewMode = 'table' | 'tree' | 'diagram';

const ServiceList = () => {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [tableTreeToggle, setTableTreeToggle] = useState<'table' | 'tree'>('tree');

  useEffect(() => {
    const fetchPackages = async () => {
      try {
        setLoading(true);
        const data = await getAllPackageHierarchies();
        setPackages(data);
        setError(null);
      } catch (err) {
        console.error('Error fetching package tree:', err);
        setError('Failed to load package hierarchy. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchPackages();
  }, []);

  const renderTree = (pkgs: Package[], level = 0) => (
    <ul className={`pl-${level * 4}`}>
      {pkgs.map((pkg) => (
        <li key={pkg.id} className="mb-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{pkg.name}</span>
            {pkg.description && (
              <span className="text-xs text-gray-500">({pkg.description})</span>
            )}
            <Link to={`/packages/${pkg.id}`} className="btn btn-xs btn-outline ml-2">
              Details
            </Link>
          </div>
          {/* Entities in this package */}
          {pkg.entities && pkg.entities.length > 0 && (
            <ul className="ml-6 mt-1">
              {pkg.entities.map((entity: Entity) => (
                <li key={entity.uuid} className="flex items-center gap-2">
                  <Link
                    to={`/services/${entity.microservice}/entities/${entity.name}`}
                    className="link"
                  >
                    {entity.name}
                  </Link>
                  <span className="text-xs text-gray-400">{entity.description}</span>
                </li>
              ))}
            </ul>
          )}
          {/* Sub-packages */}
          {pkg.subPackages && pkg.subPackages.length > 0 && renderTree(pkg.subPackages, level + 1)}
        </li>
      ))}
    </ul>
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error">
        <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Package Hierarchy</h1>
        <div className="flex gap-2">
          <button
            className={`btn btn-sm ${viewMode !== 'diagram' ? 'btn-outline' : 'btn-ghost'}`}
            onClick={() => {
              // Toggle between table and tree
              const newMode = viewMode === 'table' ? 'tree' : 'table';
              setViewMode(newMode);
              setTableTreeToggle(newMode);
            }}
          >
            {viewMode === 'table' ? 'Table View' : 'Tree View'}
          </button>
          <button
            className={`btn btn-sm ${viewMode === 'diagram' ? 'btn-outline' : 'btn-ghost'}`}
            onClick={() => setViewMode('diagram')}
          >
            Diagram View
          </button>
        </div>
      </div>
      {viewMode === 'table' ? (
        <div className="overflow-x-auto">
          <EntityFlatTable />
        </div>
      ) : viewMode === 'tree' ? (
        <div className="overflow-x-auto">
          {packages.length === 0 ? (
            <div className="alert alert-info">
              <span>No packages found. Create a new package to get started.</span>
            </div>
          ) : (
            renderTree(packages)
          )}
        </div>
      ) : (
        <div className="h-[700px]">
          <OrganizationDiagramEditor packages={packages} />
        </div>
      )}
    </div>
  );
};

export default ServiceList;