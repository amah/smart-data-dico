import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { EntityRelationship, RelationshipType } from '../types';
import { servicesApi } from '../services/api';

interface RelationshipEditorProps {
  isEdit?: boolean;
  initialData?: EntityRelationship;
  onSave?: (relationship: EntityRelationship) => Promise<void>;
}

const RelationshipEditor = ({ isEdit = false, initialData, onSave }: RelationshipEditorProps) => {
  const { service, entity } = useParams<{ service: string; entity: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableEntities, setAvailableEntities] = useState<string[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);

  const { register, handleSubmit, formState: { errors }, reset, watch } = useForm<EntityRelationship>({
    defaultValues: initialData || {
      name: '',
      description: '',
      type: RelationshipType.HAS_ONE,
      target: '',
      required: false
    }
  });

  // Reset form when initialData changes
  useEffect(() => {
    if (initialData) {
      reset(initialData);
    }
  }, [initialData, reset]);

  // Fetch available entities for the target dropdown
  useEffect(() => {
    const fetchAvailableEntities = async () => {
      if (!service) return;
      
      try {
        setLoadingEntities(true);
        // Get all services
        const servicesResponse = await servicesApi.getAllServices();
        const allServices = servicesResponse.data;
        
        // For each service, get its entities
        const allEntities: string[] = [];
        for (const svc of allServices) {
          const entitiesResponse = await servicesApi.getServiceEntities(svc);
          const entities = entitiesResponse.data.map((e: any) => `${svc}/${e.name}`);
          allEntities.push(...entities);
        }
        
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

  const onSubmit = async (data: EntityRelationship) => {
    if (!service || !entity) {
      setError('Service and entity names are required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // If onSave prop is provided, use it
      if (onSave) {
        await onSave(data);
      } else {
        // Otherwise, fetch the entity, update it, and save it back
        const response = await servicesApi.getEntitySchema(service, entity);
        const entityData = response.data;

        // Ensure relationships array exists
        if (!entityData.relationships) {
          entityData.relationships = [];
        }

        if (isEdit) {
          // Update existing relationship
          const index = entityData.relationships.findIndex(
            (rel: EntityRelationship) => rel.name === data.name
          );
          if (index !== -1) {
            entityData.relationships[index] = data;
          } else {
            throw new Error('Relationship not found');
          }
        } else {
          // Add new relationship
          entityData.relationships.push(data);
        }

        await servicesApi.updateEntity(service, entity, entityData);
      }

      // Navigate back to entity detail page
      navigate(`/services/${service}/entities/${entity}`);
    } catch (err) {
      console.error('Error saving relationship:', err);
      setError('Failed to save relationship. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const relationshipType = watch('type');

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title text-2xl mb-6">
          {isEdit ? 'Edit Relationship' : 'Create New Relationship'}
        </h2>

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
            {/* Basic Information */}
            <div className="form-control">
              <label className="label">
                <span className="label-text">Name</span>
              </label>
              <input
                type="text"
                className={`input input-bordered ${errors.name ? 'input-error' : ''}`}
                disabled={isEdit}
                {...register('name', { required: 'Name is required' })}
              />
              {errors.name && (
                <label className="label">
                  <span className="label-text-alt text-error">{errors.name.message}</span>
                </label>
              )}
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Relationship Type</span>
              </label>
              <select
                className={`select select-bordered ${errors.type ? 'select-error' : ''}`}
                {...register('type', { required: 'Type is required' })}
              >
                {Object.values(RelationshipType).map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              {errors.type && (
                <label className="label">
                  <span className="label-text-alt text-error">{errors.type.message}</span>
                </label>
              )}
            </div>

            <div className="form-control md:col-span-2">
              <label className="label">
                <span className="label-text">Description</span>
              </label>
              <textarea
                className={`textarea textarea-bordered h-24 ${errors.description ? 'textarea-error' : ''}`}
                {...register('description', { required: 'Description is required' })}
              ></textarea>
              {errors.description && (
                <label className="label">
                  <span className="label-text-alt text-error">{errors.description.message}</span>
                </label>
              )}
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Target Entity</span>
              </label>
              <select
                className={`select select-bordered ${errors.target ? 'select-error' : ''}`}
                {...register('target', { required: 'Target entity is required' })}
                disabled={loadingEntities}
              >
                <option value="">Select target entity</option>
                {availableEntities.map(entity => (
                  <option key={entity} value={entity}>{entity}</option>
                ))}
              </select>
              {loadingEntities && (
                <label className="label">
                  <span className="label-text-alt">Loading entities...</span>
                </label>
              )}
              {errors.target && (
                <label className="label">
                  <span className="label-text-alt text-error">{errors.target.message}</span>
                </label>
              )}
            </div>

            <div className="form-control">
              <label className="label cursor-pointer">
                <span className="label-text">Required</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  {...register('required')}
                />
              </label>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Inverse Relationship Name</span>
              </label>
              <input
                type="text"
                className="input input-bordered"
                placeholder="Optional"
                {...register('inverseName')}
              />
              <label className="label">
                <span className="label-text-alt">Name of the relationship from the target entity back to this entity</span>
              </label>
            </div>

            {(relationshipType === RelationshipType.HAS_ONE || 
              relationshipType === RelationshipType.BELONGS_TO) && (
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Foreign Key</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered"
                  placeholder="Optional"
                  {...register('foreignKey')}
                />
                <label className="label">
                  <span className="label-text-alt">Name of the foreign key field</span>
                </label>
              </div>
            )}
          </div>

          <div className="card-actions justify-end mt-8">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => navigate(`/services/${service}/entities/${entity}`)}
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