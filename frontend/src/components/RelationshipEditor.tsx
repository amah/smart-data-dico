import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Relationship, RelationshipEnd, RelationshipEndNamed, Cardinality, Stereotype } from '../types';
import { servicesApi, relationshipApi, stereotypeApi } from '../services/api';

interface RelationshipFormData {
  description: string;
  stereotype: string;
  sourceEntity: string;
  sourceCardinality: Cardinality;
  sourceName: string;
  sourceReferenceAttributes: string;
  targetEntity: string;
  targetCardinality: Cardinality;
  targetName: string;
  targetReferenceAttributes: string;
}

interface RelationshipEditorProps {
  isEdit?: boolean;
  initialData?: Relationship;
  onSave?: (relationship: Relationship) => Promise<void>;
  /** Service (root package) name — falls back to useParams if not provided. */
  serviceProp?: string;
  /** Owning entity name — falls back to useParams if not provided. */
  entityProp?: string;
}

function toFormData(rel: Relationship): RelationshipFormData {
  // Prefer ends[] (new symmetric shape, #99) when present
  if (rel.ends && rel.ends.length >= 2) {
    const [a, b] = rel.ends;
    return {
      description: rel.description || '',
      stereotype: rel.stereotype || '',
      sourceEntity: a.entity,
      sourceCardinality: a.cardinality,
      sourceName: a.role || '',
      sourceReferenceAttributes: (a.referenceAttributes || []).join(', '),
      targetEntity: b.entity,
      targetCardinality: b.cardinality,
      targetName: b.role || '',
      targetReferenceAttributes: (b.referenceAttributes || []).join(', '),
    };
  }
  return {
    description: rel.description || '',
    stereotype: rel.stereotype || '',
    sourceEntity: rel.source.entity,
    sourceCardinality: rel.source.cardinality,
    sourceName: rel.source.name || '',
    sourceReferenceAttributes: (rel.source.referenceAttributes || []).join(', '),
    targetEntity: rel.target.entity,
    targetCardinality: rel.target.cardinality,
    targetName: rel.target.name || '',
    targetReferenceAttributes: (rel.target.referenceAttributes || []).join(', '),
  };
}

function toRelationship(data: RelationshipFormData, uuid: string): Relationship {
  const parseAttrs = (raw: string): string[] | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  };

  // Write the new ends[] shape (#99). Keep source/target for backward
  // compat readers until all consumers switch.
  const endA: RelationshipEndNamed = {
    entity: data.sourceEntity,
    cardinality: data.sourceCardinality,
    ...(data.sourceName.trim() && { role: data.sourceName.trim() }),
    ...(parseAttrs(data.sourceReferenceAttributes) && {
      referenceAttributes: parseAttrs(data.sourceReferenceAttributes),
    }),
  };
  const endB: RelationshipEndNamed = {
    entity: data.targetEntity,
    cardinality: data.targetCardinality,
    ...(data.targetName.trim() && { role: data.targetName.trim() }),
    ...(parseAttrs(data.targetReferenceAttributes) && {
      referenceAttributes: parseAttrs(data.targetReferenceAttributes),
    }),
  };
  const source: RelationshipEnd = {
    entity: endA.entity,
    cardinality: endA.cardinality,
    ...(endA.role && { name: endA.role }),
    ...(endA.referenceAttributes && { referenceAttributes: endA.referenceAttributes }),
  };
  const target: RelationshipEnd = {
    entity: endB.entity,
    cardinality: endB.cardinality,
    ...(endB.role && { name: endB.role }),
    ...(endB.referenceAttributes && { referenceAttributes: endB.referenceAttributes }),
  };

  return {
    uuid,
    ...(data.description.trim() && { description: data.description.trim() }),
    ...(data.stereotype && { stereotype: data.stereotype }),
    ends: [endA, endB],
    source,
    target,
  };
}

const defaultFormValues: RelationshipFormData = {
  description: '',
  stereotype: '',
  sourceEntity: '',
  sourceCardinality: Cardinality.ONE,
  sourceName: '',
  sourceReferenceAttributes: '',
  targetEntity: '',
  targetCardinality: Cardinality.MANY,
  targetName: '',
  targetReferenceAttributes: '',
};

const RelationshipEditor = ({ isEdit = false, initialData, onSave, serviceProp, entityProp }: RelationshipEditorProps) => {
  const params = useParams<{ service: string; entity: string }>();
  const service = serviceProp || params.service;
  const entity = entityProp || params.entity;
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each option carries the UUID (form value) + a human label "svc/Name"
  // — the relationship model addresses entities by UUID, so storing the UUID
  // here is what makes cross-package relationships round-trip correctly.
  const [availableEntities, setAvailableEntities] = useState<Array<{ uuid: string; label: string }>>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [relationshipStereotypes, setRelationshipStereotypes] = useState<Stereotype[]>([]);

  useEffect(() => {
    stereotypeApi.getAll('relationship').then(setRelationshipStereotypes).catch(() => {});
  }, []);

  const { register, handleSubmit, formState: { errors }, reset } = useForm<RelationshipFormData>({
    defaultValues: initialData ? toFormData(initialData) : defaultFormValues,
  });

  // Reset form when initialData changes
  useEffect(() => {
    if (initialData) {
      reset(toFormData(initialData));
    }
  }, [initialData, reset]);

  // Fetch available entities for the dropdowns
  useEffect(() => {
    const fetchAvailableEntities = async () => {
      if (!service) return;

      try {
        setLoadingEntities(true);
        const servicesResponse = await servicesApi.getAllServices();
        const allServices = servicesResponse.data;

        const allEntities: Array<{ uuid: string; label: string }> = [];
        for (const svc of allServices) {
          const entitiesResponse = await servicesApi.getServiceEntities(svc);
          for (const e of entitiesResponse.data) {
            if (typeof e?.uuid !== 'string') continue;
            allEntities.push({ uuid: e.uuid, label: `${svc}/${e.name}` });
          }
        }
        allEntities.sort((a, b) => a.label.localeCompare(b.label));

        setAvailableEntities(allEntities);
      } catch (err) {
        console.error('Error fetching available entities:', err);
        setError('Failed to load available entities');
      } finally {
        setLoadingEntities(false);
      }
    };

    fetchAvailableEntities();
  }, [service]);

  const onSubmit = async (data: RelationshipFormData) => {
    if (!service || !entity) {
      setError('Service and entity names are required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const uuid = initialData?.uuid || crypto.randomUUID();
      const relationship = toRelationship(data, uuid);

      if (onSave) {
        await onSave(relationship);
      } else if (isEdit) {
        await relationshipApi.updateRelationship(service, uuid, relationship);
      } else {
        await relationshipApi.createRelationship(service, relationship);
      }

      navigate(`/packages/${service}/entities/${entity}`);
    } catch (err) {
      console.error('Error saving relationship:', err);
      setError('Failed to save relationship. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderEndSection = (
    label: string,
    prefix: 'source' | 'target',
  ) => (
    <fieldset className="border border-base-300 rounded-lg p-4 md:col-span-2">
      <legend className="text-lg font-semibold px-2">{label}</legend>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Entity */}
        <div className="form-control">
          <label className="label">
            <span className="label-text">Entity</span>
          </label>
          <select
            className={`select select-bordered ${errors[`${prefix}Entity`] ? 'select-error' : ''}`}
            {...register(`${prefix}Entity` as const, { required: 'Entity is required' })}
            disabled={loadingEntities}
          >
            <option value="">Select entity</option>
            {availableEntities.map(ent => (
              <option key={ent.uuid} value={ent.uuid}>{ent.label}</option>
            ))}
          </select>
          {loadingEntities && (
            <label className="label">
              <span className="label-text-alt">Loading entities...</span>
            </label>
          )}
          {errors[`${prefix}Entity`] && (
            <label className="label">
              <span className="label-text-alt text-error">
                {errors[`${prefix}Entity`]?.message}
              </span>
            </label>
          )}
        </div>

        {/* Cardinality */}
        <div className="form-control">
          <label className="label">
            <span className="label-text">Cardinality</span>
          </label>
          <select
            className={`select select-bordered ${errors[`${prefix}Cardinality`] ? 'select-error' : ''}`}
            {...register(`${prefix}Cardinality` as const, { required: 'Cardinality is required' })}
          >
            <option value={Cardinality.ONE}>one</option>
            <option value={Cardinality.MANY}>many</option>
          </select>
          {errors[`${prefix}Cardinality`] && (
            <label className="label">
              <span className="label-text-alt text-error">
                {errors[`${prefix}Cardinality`]?.message}
              </span>
            </label>
          )}
        </div>

        {/* Role at this end */}
        <div className="form-control">
          <label className="label">
            <span className="label-text">Role (at this end)</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            placeholder="Optional"
            {...register(`${prefix}Name` as const)}
          />
          <label className="label">
            <span className="label-text-alt">
              Field name at THIS entity for reaching the other end — e.g. "items" on Order's end means <code>Order.items</code>
            </span>
          </label>
        </div>

        {/* Reference attributes */}
        <div className="form-control">
          <label className="label">
            <span className="label-text">Reference Attributes</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            placeholder="Optional, comma-separated"
            {...register(`${prefix}ReferenceAttributes` as const)}
          />
          <label className="label">
            <span className="label-text-alt">
              Comma-separated list of attribute names used as reference keys
            </span>
          </label>
        </div>
      </div>
    </fieldset>
  );

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title text-2xl mb-6">
          {isEdit ? 'Edit Relationship' : 'Create New Relationship'}
        </h2>

        <div className="alert alert-info mb-4 text-sm">
          <span>
            A relationship has two symmetric ends. Each end carries its own <b>role</b> —
            the field name at THAT entity used to reach the other end.
            Example: <code>Order — items / order → OrderItem</code> means
            <code> Order.items</code> and <code>OrderItem.order</code>.
          </span>
        </div>

        {error && (
          <div className="alert alert-error mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Description */}
            <div className="form-control md:col-span-2">
              <label className="label">
                <span className="label-text">Description</span>
              </label>
              <textarea
                className="textarea textarea-bordered h-24"
                placeholder="Optional description of this relationship"
                {...register('description')}
              ></textarea>
            </div>

            {/* Stereotype */}
            <div className="form-control md:col-span-2">
              <label className="label">
                <span className="label-text">Stereotype</span>
              </label>
              <select
                className="select select-bordered"
                {...register('stereotype')}
              >
                <option value="">— None —</option>
                {relationshipStereotypes.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Source section */}
            {renderEndSection('Source', 'source')}

            {/* Target section */}
            {renderEndSection('Target', 'target')}
          </div>

          <div className="card-actions justify-end mt-8">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => navigate(`/packages/${service}/entities/${entity}`)}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Saving...
                </>
              ) : (
                'Save Relationship'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RelationshipEditor;
