import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Attribute, AttributeType } from '../types';

interface AttributeListProps {
  attributes: Attribute[];
  entityName: string;
  serviceName: string;
}

const AttributeList = ({ attributes, entityName, serviceName }: AttributeListProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<AttributeType | 'all'>('all');

  const filteredAttributes = attributes.filter(attr => {
    const matchesSearch = searchTerm === '' ||
      attr.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      attr.description.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType = filterType === 'all' || attr.type === filterType;

    return matchesSearch && matchesType;
  });

  const getTypeColor = (type: AttributeType) => {
    switch (type) {
      case AttributeType.STRING:
        return 'badge-primary';
      case AttributeType.NUMBER:
      case AttributeType.INTEGER:
        return 'badge-secondary';
      case AttributeType.BOOLEAN:
        return 'badge-accent';
      case AttributeType.DATETIME:
      case AttributeType.DATE:
      case AttributeType.TIME:
      case AttributeType.DATE_TIME:
      case AttributeType.TIMESTAMP:
      case AttributeType.DURATION:
        return 'badge-info';
      case AttributeType.ENUM:
        return 'badge-warning';
      case AttributeType.OBJECT:
      case AttributeType.ARRAY:
        return 'badge-success';
      default:
        return 'badge-ghost';
    }
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row gap-4 mb-4">
        <div className="form-control flex-1">
          <div className="input-group">
            <input
              type="text"
              placeholder="Search attributes..."
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
          onChange={(e) => setFilterType(e.target.value as AttributeType | 'all')}
        >
          <option value="all">All Types</option>
          {Object.values(AttributeType).map(type => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </div>

      {filteredAttributes.length === 0 ? (
        <div className="alert alert-info">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <span>No attributes found matching your criteria.</span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-zebra w-full">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Description</th>
                <th>Required</th>
                <th>Constraints</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAttributes.map((attr) => (
                <tr key={attr.name} className="hover">
                  <td className="font-medium">
                    {attr.name}
                    {attr.primaryKey && (
                      <span className="badge badge-xs badge-warning ml-1" title="Primary Key">PK</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${getTypeColor(attr.type)}`}>
                      {attr.type}
                    </span>
                  </td>
                  <td className="max-w-xs truncate">{attr.description}</td>
                  <td>
                    {attr.required ? (
                      <span className="badge badge-success">Required</span>
                    ) : (
                      <span className="badge badge-ghost">Optional</span>
                    )}
                  </td>
                  <td>
                    {attr.constraints?.format && <div><span className="font-medium">Format:</span> {attr.constraints.format}</div>}
                    {attr.constraints?.minLength !== undefined && <div><span className="font-medium">Min Length:</span> {attr.constraints.minLength}</div>}
                    {attr.constraints?.maxLength !== undefined && <div><span className="font-medium">Max Length:</span> {attr.constraints.maxLength}</div>}
                    {attr.constraints?.minimum !== undefined && <div><span className="font-medium">Min:</span> {attr.constraints.minimum}</div>}
                    {attr.constraints?.maximum !== undefined && <div><span className="font-medium">Max:</span> {attr.constraints.maximum}</div>}
                    {attr.constraints?.pattern && <div><span className="font-medium">Pattern:</span> {attr.constraints.pattern}</div>}
                    {attr.constraints?.enumValues && attr.constraints.enumValues.length > 0 && (
                      <div>
                        <span className="font-medium">Values:</span> {attr.constraints.enumValues.join(', ')}
                      </div>
                    )}
                    {!attr.constraints && '-'}
                  </td>
                  <td>
                    <Link
                      to={`/packages/${serviceName}/entities/${entityName}/attributes/${attr.name}/edit`}
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
          to={`/packages/${serviceName}/entities/${entityName}/attributes/create`}
          className="btn btn-primary"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          Add Attribute
        </Link>
      </div>
    </div>
  );
};

export default AttributeList;
