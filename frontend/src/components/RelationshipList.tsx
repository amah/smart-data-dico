import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EntityRelationship, RelationshipType } from '../types';

interface RelationshipListProps {
  relationships: EntityRelationship[];
  entityName: string;
  serviceName: string;
}

const RelationshipList = ({ relationships, entityName, serviceName }: RelationshipListProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<RelationshipType | 'all'>('all');

  const filteredRelationships = relationships.filter(rel => {
    const matchesSearch = searchTerm === '' || 
      rel.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rel.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rel.target.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesType = filterType === 'all' || rel.type === filterType;
    
    return matchesSearch && matchesType;
  });

  const getTypeColor = (type: RelationshipType) => {
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

  const getTypeIcon = (type: RelationshipType) => {
    switch (type) {
      case RelationshipType.HAS_ONE:
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
        );
      case RelationshipType.HAS_MANY:
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
          </svg>
        );
      case RelationshipType.BELONGS_TO:
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        );
      case RelationshipType.MANY_TO_MANY:
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
        );
      default:
        return null;
    }
  };

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
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as RelationshipType | 'all')}
        >
          <option value="all">All Types</option>
          {Object.values(RelationshipType).map(type => (
            <option key={type} value={type}>{type}</option>
          ))}
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
                <th>Name</th>
                <th>Type</th>
                <th>Target Entity</th>
                <th>Description</th>
                <th>Required</th>
                <th>Foreign Key</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRelationships.map((rel) => (
                <tr key={rel.name} className="hover">
                  <td className="font-medium">{rel.name}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      {getTypeIcon(rel.type)}
                      <span className={`badge ${getTypeColor(rel.type)}`}>
                        {rel.type}
                      </span>
                    </div>
                  </td>
                  <td>
                    <Link 
                      to={`/services/${serviceName}/entities/${rel.target}`}
                      className="link link-hover link-primary"
                    >
                      {rel.target}
                    </Link>
                  </td>
                  <td className="max-w-xs truncate">{rel.description}</td>
                  <td>
                    {rel.required ? (
                      <span className="badge badge-success">Required</span>
                    ) : (
                      <span className="badge badge-ghost">Optional</span>
                    )}
                  </td>
                  <td>{rel.foreignKey || '-'}</td>
                  <td>
                    <Link 
                      to={`/services/${serviceName}/entities/${entityName}/relationships/${rel.name}/edit`}
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