import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { entityApi } from '../services/api';
import { Entity, EntityAttribute, EntityRelationship, RelationshipType } from '../types';

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

// Format target entity to remove service prefix if no ambiguity
const formatTargetEntity = (target: string): string => {
  // Handle both slash and dot separators
  const separator = target.includes('/') ? '/' : (target.includes('.') ? '.' : null);
  if (!separator) return target;
  
  const [service, entityName] = target.split(separator);
  
  // For common entities like User and Product, always return just the entity name
  if (entityName === 'User' || entityName === 'Product' || entityName === 'Order') {
    return entityName;
  }
  
  // Since we don't have a list of all entities here, we'll just return the entity name
  // for most cases, as ambiguity is rare
  return entityName;
};

const renderRelationships = (relationships: EntityRelationship[] | undefined) => {
  if (!relationships || relationships.length === 0) {
    return null;
  }
  
  // UML-style relationship icon based on type
  const getRelationshipIcon = (type: RelationshipType) => {
    switch (type) {
      case RelationshipType.HAS_ONE:
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="inline-block h-4 w-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        );
      case RelationshipType.HAS_MANY:
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="inline-block h-4 w-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
            <line x1="16" y1="8" x2="16" y2="16" strokeWidth="4"></line>
          </svg>
        );
      case RelationshipType.BELONGS_TO:
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="inline-block h-4 w-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <circle cx="5" cy="12" r="3" fill="white"></circle>
          </svg>
        );
      case RelationshipType.MANY_TO_MANY:
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="inline-block h-4 w-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <line x1="5" y1="8" x2="5" y2="16" strokeWidth="4"></line>
            <line x1="19" y1="8" x2="19" y2="16" strokeWidth="4"></line>
          </svg>
        );
      default:
        return null;
    }
  };
  
  // Get relationship type color
  const getRelationshipTypeColor = (type: RelationshipType) => {
    switch (type) {
      case RelationshipType.HAS_ONE:
        return 'badge-primary';
      case RelationshipType.HAS_MANY:
        return 'badge-secondary';
      case RelationshipType.BELONGS_TO:
        return 'badge-accent';
      case RelationshipType.MANY_TO_MANY:
        return 'badge-info';
      default:
        return 'badge-ghost';
    }
  };
  
  return (
    <table className="table table-xs w-full mb-2">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Required</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {relationships.map(rel => (
          <tr key={rel.uuid}>
            <td>{rel.name}</td>
            <td>
              <div className="flex items-center gap-2">
                {getRelationshipIcon(rel.type)}
                <span className="text-sm text-gray-500">→ {formatTargetEntity(rel.target)}</span>
              </div>
            </td>
            <td>{rel.required ? 'Yes' : 'No'}</td>
            <td>{rel.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const renderHierarchy = (node: HierarchyNode, depth = 0) => (
  <div
    className="ml-4 border-l-2 border-base-300 pl-4 mb-4"
    style={{ marginLeft: depth * 16 }}
  >
    <div className="flex items-center justify-between font-bold text-base w-full">
      {/* Left: Entity info and inline actions */}
      <div className="flex items-center gap-2">
        <span className="mr-2">{node.entity.name}</span>
        <span className="badge badge-outline badge-sm ml-1">{node.entity.microservice}</span>
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
          ✏️
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
          🗑️
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
          ➕
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
          ⬆️
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
          ⬇️
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
          ⬅️
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
          ➡️
        </button>
      </div>
    </div>
    <div className="mb-2">
      {renderAttributes(node.entity.attributes)}
    </div>
    
    {node.entity.relationships && node.entity.relationships.length > 0 && (
      <div className="mb-4">
        <div className="font-semibold text-sm mb-1">Relationships:</div>
        {renderRelationships(node.entity.relationships)}
      </div>
    )}
    
    {node.children && node.children.length > 0 && (
      <div>
        <div className="font-semibold text-sm mb-1">Child Entities (Composition):</div>
        {node.children.map(child => renderHierarchy(child, depth + 1))}
      </div>
    )}
  </div>
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