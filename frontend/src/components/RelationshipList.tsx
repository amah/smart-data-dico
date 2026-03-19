import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Relationship, Cardinality } from '../types';

interface RelationshipListProps {
  relationships: Relationship[];
  entityName: string;
  serviceName: string;
}

const RelationshipList = ({ relationships, entityName, serviceName }: RelationshipListProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCardinality, setFilterCardinality] = useState<string>('all');

  const getCardinalityLabel = (source: string, target: string) => {
    if (source === Cardinality.ONE && target === Cardinality.ONE) return 'One-to-One';
    if (source === Cardinality.ONE && target === Cardinality.MANY) return 'One-to-Many';
    if (source === Cardinality.MANY && target === Cardinality.ONE) return 'Many-to-One';
    if (source === Cardinality.MANY && target === Cardinality.MANY) return 'Many-to-Many';
    return `${source}:${target}`;
  };

  const getCardinalityColor = (source: string, target: string) => {
    if (source === Cardinality.ONE && target === Cardinality.ONE) return 'badge-primary';
    if (source === Cardinality.ONE && target === Cardinality.MANY) return 'badge-secondary';
    if (source === Cardinality.MANY && target === Cardinality.ONE) return 'badge-accent';
    if (source === Cardinality.MANY && target === Cardinality.MANY) return 'badge-info';
    return 'badge-ghost';
  };

  const filteredRelationships = relationships.filter(rel => {
    const matchesSearch = searchTerm === '' ||
      (rel.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rel.source.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rel.target.name || '').toLowerCase().includes(searchTerm.toLowerCase());

    if (filterCardinality === 'all') return matchesSearch;
    const cardLabel = getCardinalityLabel(rel.source.cardinality, rel.target.cardinality);
    return matchesSearch && cardLabel === filterCardinality;
  });

  return (
    <div>
      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <div className="form-control flex-1">
          <div className="input-group">
            <input
              type="text"
              placeholder="Search relationships..."
              className="input input-bordered w-full"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                className="btn btn-square"
                onClick={() => setSearchTerm('')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <select
          className="select select-bordered"
          value={filterCardinality}
          onChange={(e) => setFilterCardinality(e.target.value)}
        >
          <option value="all">All Cardinalities</option>
          <option value="One-to-One">One-to-One</option>
          <option value="One-to-Many">One-to-Many</option>
          <option value="Many-to-One">Many-to-One</option>
          <option value="Many-to-Many">Many-to-Many</option>
        </select>
      </div>

      {relationships.length === 0 ? (
        <div className="alert alert-info">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <span>No relationships defined for this entity.</span>
        </div>
      ) : filteredRelationships.length === 0 ? (
        <div className="alert alert-info">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <span>No relationships found matching your criteria.</span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-zebra w-full">
            <thead>
              <tr>
                <th>Source</th>
                <th>Cardinality</th>
                <th>Target</th>
                <th>Description</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRelationships.map((rel) => (
                <tr key={rel.uuid} className="hover">
                  <td>
                    <div>
                      <span className="font-medium">{rel.source.name || rel.source.entity}</span>
                      <span className="text-xs text-base-content/50 ml-1">({rel.source.cardinality})</span>
                    </div>
                    {rel.source.referenceAttributes && rel.source.referenceAttributes.length > 0 && (
                      <div className="text-xs text-base-content/50">via: {rel.source.referenceAttributes.join(', ')}</div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${getCardinalityColor(rel.source.cardinality, rel.target.cardinality)}`}>
                      {getCardinalityLabel(rel.source.cardinality, rel.target.cardinality)}
                    </span>
                  </td>
                  <td>
                    <div>
                      <span className="font-medium">{rel.target.name || rel.target.entity}</span>
                      <span className="text-xs text-base-content/50 ml-1">({rel.target.cardinality})</span>
                    </div>
                    {rel.target.referenceAttributes && rel.target.referenceAttributes.length > 0 && (
                      <div className="text-xs text-base-content/50">via: {rel.target.referenceAttributes.join(', ')}</div>
                    )}
                  </td>
                  <td className="max-w-xs truncate">{rel.description || '-'}</td>
                  <td>
                    <Link
                      to={`/services/${serviceName}/entities/${entityName}/relationships/${rel.uuid}/edit`}
                      className="btn btn-sm btn-ghost btn-square"
                      title="Edit"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                      </svg>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6">
        <Link
          to={`/services/${serviceName}/entities/${entityName}/relationships/create`}
          className="btn btn-primary"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          Add Relationship
        </Link>
      </div>
    </div>
  );
};

export default RelationshipList;
