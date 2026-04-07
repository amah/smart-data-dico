import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Attribute, AttributeType, Entity } from '../types';
import { useStereotypeMetadata, getActiveColumns, getMetadataValue, setMetadataValue } from '../hooks/useStereotypeMetadata';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';
import InlineMetadataCell from './InlineMetadataCell';
import EditableCell, { SelectOption } from './EditableCell';
import { servicesApi } from '../services/api';

const ATTRIBUTE_TYPE_OPTIONS: SelectOption[] = Object.values(AttributeType).map((t) => ({
  value: t,
  label: t,
}));

interface AttributeListProps {
  attributes: Attribute[];
  entityName: string;
  serviceName: string;
  onAttributeUpdated?: () => void;
}

interface DraftAttribute {
  id: string;
  name: string;
  type: AttributeType;
  description: string;
  required: boolean;
}

const emptyDraft = (): DraftAttribute => ({
  id: crypto.randomUUID(),
  name: '',
  type: AttributeType.STRING,
  description: '',
  required: false,
});

const AttributeList = ({ attributes, entityName, serviceName, onAttributeUpdated }: AttributeListProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<AttributeType | 'all'>('all');
  const { allColumns, loading: stereotypesLoading } = useStereotypeMetadata('attribute');

  // Inline editing state
  const [drafts, setDrafts] = useState<DraftAttribute[]>([]);
  const [saving, setSaving] = useState(false);

  // Detect which metadata columns are relevant for this set of attributes
  const metadataColumns = getActiveColumns(attributes, allColumns);

  const filteredAttributes = attributes.filter(attr => {
    const matchesSearch = searchTerm === '' ||
      attr.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      attr.description.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesType = filterType === 'all' || attr.type === filterType;

    return matchesSearch && matchesType;
  });

  const handleMetadataChange = useCallback(async (
    attr: Attribute,
    column: MetadataColumn,
    value: string | number | boolean,
  ) => {
    try {
      // Fetch fresh entity, update the attribute's metadata, save
      const response = await servicesApi.getEntitySchema(serviceName, entityName);
      const entity = response.data;
      const attrIndex = entity.attributes.findIndex((a: Attribute) => a.uuid === attr.uuid);
      if (attrIndex < 0) return;

      entity.attributes[attrIndex].metadata = setMetadataValue(
        entity.attributes[attrIndex].metadata,
        column.name,
        value,
      );

      await servicesApi.updateEntity(serviceName, entityName, entity);
      onAttributeUpdated?.();
    } catch (err) {
      console.error('Failed to update metadata:', err);
    }
  }, [serviceName, entityName, onAttributeUpdated]);

  /** Inline-edit save: fetch fresh entity, mutate one attribute field, PUT back. */
  const saveAttributeField = useCallback(async (
    attr: Attribute,
    updater: (a: Attribute) => Attribute,
  ) => {
    const response = await servicesApi.getEntitySchema(serviceName, entityName);
    const entity: Entity = response.data;
    const attrIndex = entity.attributes.findIndex(a => a.uuid === attr.uuid);
    if (attrIndex < 0) throw new Error('Attribute not found');
    entity.attributes[attrIndex] = updater(entity.attributes[attrIndex]);
    await servicesApi.updateEntity(serviceName, entityName, entity);
    onAttributeUpdated?.();
  }, [serviceName, entityName, onAttributeUpdated]);

  const addDraftRow = useCallback(() => {
    setDrafts(prev => [...prev, emptyDraft()]);
  }, []);

  const updateDraft = useCallback((id: string, field: keyof DraftAttribute, value: any) => {
    setDrafts(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d));
  }, []);

  const removeDraft = useCallback((id: string) => {
    setDrafts(prev => prev.filter(d => d.id !== id));
  }, []);

  const saveDrafts = useCallback(async () => {
    const validDrafts = drafts.filter(d => d.name.trim());
    if (validDrafts.length === 0) return;
    setSaving(true);
    try {
      const response = await servicesApi.getEntitySchema(serviceName, entityName);
      const entity = response.data;
      for (const draft of validDrafts) {
        entity.attributes.push({
          uuid: crypto.randomUUID(),
          name: draft.name.trim(),
          type: draft.type,
          description: draft.description.trim(),
          required: draft.required,
        });
      }
      await servicesApi.updateEntity(serviceName, entityName, entity);
      setDrafts([]);
      onAttributeUpdated?.();
    } catch (err) {
      console.error('Failed to save attributes:', err);
    } finally {
      setSaving(false);
    }
  }, [drafts, serviceName, entityName, onAttributeUpdated]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes(',')) return; // Not tabular data
    e.preventDefault();
    const sep = text.includes('\t') ? '\t' : ',';
    const lines = text.split('\n').filter(l => l.trim());
    const newDrafts: DraftAttribute[] = lines.map(line => {
      const cols = line.split(sep).map(c => c.trim());
      const typeVal = (cols[1] || 'string').toLowerCase();
      const matchedType = Object.values(AttributeType).find(t => t === typeVal) || AttributeType.STRING;
      return {
        id: crypto.randomUUID(),
        name: cols[0] || '',
        type: matchedType,
        description: cols[2] || '',
        required: ['yes', 'true', '1'].includes((cols[3] || '').toLowerCase()),
      };
    }).filter(d => d.name);
    if (newDrafts.length > 0) {
      setDrafts(prev => [...prev, ...newDrafts]);
    }
  }, []);

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
                {metadataColumns.map(col => (
                  <th key={col.name} title={col.description}>
                    <span className="flex items-center gap-1">
                      {col.label}
                      <span className="badge badge-xs badge-ghost font-normal">{col.stereotypeName}</span>
                    </span>
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAttributes.map((attr) => (
                <tr key={attr.uuid} className="hover">
                  <EditableCell
                    className="font-medium"
                    value={attr.name}
                    onSave={async (v) => {
                      await saveAttributeField(attr, (a) => ({ ...a, name: v as string }));
                    }}
                    renderDisplay={(v) => (
                      <span>
                        {v?.toString() || '-'}
                        {attr.primaryKey && (
                          <span className="badge badge-xs badge-warning ml-1" title="Primary Key">PK</span>
                        )}
                      </span>
                    )}
                  />
                  <EditableCell
                    value={attr.type}
                    inputType="select"
                    options={ATTRIBUTE_TYPE_OPTIONS}
                    onSave={async (v) => {
                      await saveAttributeField(attr, (a) => ({ ...a, type: v as AttributeType }));
                    }}
                    renderDisplay={(v) => (
                      <span className={`badge ${getTypeColor(v as AttributeType)}`}>
                        {v?.toString()}
                      </span>
                    )}
                  />
                  <EditableCell
                    value={attr.description || ''}
                    inputType="textarea"
                    className="max-w-xs"
                    onSave={async (v) => {
                      await saveAttributeField(attr, (a) => ({ ...a, description: v as string }));
                    }}
                  />
                  <EditableCell
                    value={attr.required}
                    inputType="toggle"
                    ariaLabel={`${attr.name} required`}
                    onSave={async (v) => {
                      await saveAttributeField(attr, (a) => ({ ...a, required: v as boolean }));
                    }}
                  />
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
                  {metadataColumns.map(col => (
                    <td key={col.name}>
                      <InlineMetadataCell
                        value={getMetadataValue(attr, col.name)}
                        column={col}
                        onChange={(val) => handleMetadataChange(attr, col, val)}
                      />
                    </td>
                  ))}
                  <td>
                    <Link
                      to={`/packages/${serviceName}/entities/${entityName}/attributes/${attr.name}/edit`}
                      className="btn btn-sm btn-ghost btn-square"
                      title="Open full editor (constraints, examples, etc.)"
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

      {/* Inline draft rows */}
      {drafts.length > 0 && (
        <div className="overflow-x-auto mt-2 border-2 border-primary/30 rounded-lg" onPaste={handlePaste}>
          <table className="table table-sm w-full">
            <thead>
              <tr className="bg-primary/10">
                <th>Name</th>
                <th>Type</th>
                <th>Description</th>
                <th>Required</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft, idx) => (
                <tr key={draft.id}>
                  <td>
                    <input
                      type="text"
                      className="input input-xs input-bordered w-full"
                      placeholder="attributeName"
                      value={draft.name}
                      onChange={(e) => updateDraft(draft.id, 'name', e.target.value)}
                      autoFocus={idx === drafts.length - 1}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addDraftRow();
                      }}
                    />
                  </td>
                  <td>
                    <select
                      className="select select-xs select-bordered"
                      value={draft.type}
                      onChange={(e) => updateDraft(draft.id, 'type', e.target.value)}
                    >
                      {Object.values(AttributeType).map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="text"
                      className="input input-xs input-bordered w-full"
                      placeholder="Description"
                      value={draft.description}
                      onChange={(e) => updateDraft(draft.id, 'description', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs checkbox-primary"
                      checked={draft.required}
                      onChange={(e) => updateDraft(draft.id, 'required', e.target.checked)}
                    />
                  </td>
                  <td>
                    <button className="btn btn-xs btn-ghost text-error" onClick={() => removeDraft(draft.id)}>
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-4 flex gap-2 flex-wrap">
        <button className="btn btn-sm btn-outline" onClick={addDraftRow} onPaste={handlePaste}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          Add Row
        </button>
        {drafts.length > 0 && (
          <>
            <button className="btn btn-sm btn-primary" onClick={saveDrafts} disabled={saving}>
              {saving ? (
                <><span className="loading loading-spinner loading-xs"></span> Saving...</>
              ) : (
                `Save ${drafts.filter(d => d.name.trim()).length} Attributes`
              )}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setDrafts([])}>
              Discard
            </button>
          </>
        )}
        <div className="text-xs text-base-content/50 flex items-center ml-2">
          Tip: Paste from Excel (name, type, description, required)
        </div>
      </div>
    </div>
  );
};

export default AttributeList;
