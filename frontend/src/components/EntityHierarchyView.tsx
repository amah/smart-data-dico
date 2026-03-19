import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { entityApi } from '../services/api';
import { Entity, EntityAttribute } from '../types';

interface HierarchyNode {
  entity: Entity;
  children?: HierarchyNode[];
}

const renderAttributes = (attributes: EntityAttribute[]) => (
  <table className="table table-xs w-full mb-2">
    <thead>
      <tr>
        <th>Name</th>
        <th>Type</th>
        <th>Required</th>
        <th>Description</th>
        <th>Metadata</th>
      </tr>
    </thead>
    <tbody>
      {attributes.map(attr => (
        <tr key={attr.uuid}>
          <td>{attr.name}</td>
          <td>{attr.type}</td>
          <td>{attr.required ? 'Yes' : 'No'}</td>
          <td>{attr.description}</td>
          <td>
            {attr.metadata
              ? Object.entries(attr.metadata).map(([k, v]) => (
                  <div key={k}><b>{k}:</b> {String(v)}</div>
                ))
              : '-'}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const EntityHierarchyView = () => {
  const { microservice, entityName } = useParams<{ microservice: string; entityName: string }>();
  const [hierarchy, setHierarchy] = useState<HierarchyNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!microservice || !entityName) return;
    setLoading(true);
    setError(null);
    entityApi.getEntityHierarchy(microservice, entityName)
      .then(data => {
        // Assume backend returns { entity, children }
        setHierarchy(data);
      })
      .catch(() => setError('Failed to load entity hierarchy.'))
      .finally(() => setLoading(false));
  }, [microservice, entityName]);

  const renderHierarchy = (node: HierarchyNode, depth = 0) => (
    <div
      className="ml-4 border-l-2 border-base-300 pl-4 mb-4"
      style={{ marginLeft: depth * 16 }}
    >
      <div className="flex items-center justify-between font-bold text-base w-full">
        {/* Left: Entity info and inline actions */}
        <div className="flex items-center gap-2">
          <span className="mr-2">{node.entity.name}</span>
          <span className="badge badge-outline badge-sm ml-1">{microservice}</span>
          <span className="ml-2 text-xs text-gray-500">{node.entity.description}</span>
          {/* Inline actions */}
          <button
            className="btn btn-xs btn-outline ml-2"
            title="Edit"
            onClick={() => {
              // TODO: Implement edit logic
              // eslint-disable-next-line no-console
              console.log('Edit', node.entity);
            }}
          >
            Edit
          </button>
          <button
            className="btn btn-xs btn-outline ml-1"
            title="Delete"
            onClick={() => {
              // TODO: Implement delete logic
              // eslint-disable-next-line no-console
              console.log('Delete', node.entity);
            }}
          >
            Delete
          </button>
          <button
            className="btn btn-xs btn-outline ml-1"
            title="Add Child"
            onClick={() => {
              // TODO: Implement add child logic
              // eslint-disable-next-line no-console
              console.log('Add Child', node.entity);
            }}
          >
            Add
          </button>
        </div>
        {/* Right: Move buttons */}
        <div className="flex items-center gap-1">
          <button
            className="btn btn-xs btn-ghost"
            title="Move Up"
            onClick={() => {
              // TODO: Implement move up logic
              // eslint-disable-next-line no-console
              console.log('Move Up', node.entity);
            }}
          >
            Up
          </button>
          <button
            className="btn btn-xs btn-ghost"
            title="Move Down"
            onClick={() => {
              // TODO: Implement move down logic
              // eslint-disable-next-line no-console
              console.log('Move Down', node.entity);
            }}
          >
            Down
          </button>
          <button
            className="btn btn-xs btn-ghost"
            title="Move Left"
            onClick={() => {
              // TODO: Implement move left logic
              // eslint-disable-next-line no-console
              console.log('Move Left', node.entity);
            }}
          >
            Left
          </button>
          <button
            className="btn btn-xs btn-ghost"
            title="Move Right"
            onClick={() => {
              // TODO: Implement move right logic
              // eslint-disable-next-line no-console
              console.log('Move Right', node.entity);
            }}
          >
            Right
          </button>
        </div>
      </div>
      <div className="mb-2">
        {renderAttributes(node.entity.attributes)}
      </div>

      {node.children && node.children.length > 0 && (
        <div>
          <div className="font-semibold text-sm mb-1">Child Entities (Composition):</div>
          {node.children.map(child => renderHierarchy(child, depth + 1))}
        </div>
      )}
    </div>
  );

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold mb-4">
        Entity Hierarchy: {entityName} <span className="badge badge-outline ml-2">{microservice}</span>
      </h1>
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : hierarchy ? (
        <div>
          {renderHierarchy(hierarchy)}
        </div>
      ) : (
        <div className="text-gray-500">No hierarchy data found.</div>
      )}
    </div>
  );
};

export default EntityHierarchyView;