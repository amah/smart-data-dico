import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { EntityAttribute, AttributeType } from '../types';
import { servicesApi } from '../services/api';

interface AttributeEditorProps {
  isEdit?: boolean;
  initialData?: EntityAttribute;
  onSave?: (attribute: EntityAttribute) => Promise<void>;
}

const AttributeEditor = ({ isEdit = false, initialData, onSave }: AttributeEditorProps) => {
  const { service, entity } = useParams<{ service: string; entity: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<AttributeType>(
    initialData?.type || AttributeType.STRING
  );

  const { register, handleSubmit, control, formState: { errors }, reset, watch } = useForm<EntityAttribute>({
    defaultValues: initialData || {
      name: '',
      description: '',
      type: AttributeType.STRING,
      required: false,
      unique: false
    }
  });

  // Reset form when initialData changes
  useEffect(() => {
    if (initialData) {
      reset(initialData);
      setSelectedType(initialData.type);
    }
  }, [initialData, reset]);

  // Watch the type field to update the selectedType state
  const watchedType = watch('type');
  useEffect(() => {
    setSelectedType(watchedType as AttributeType);
  }, [watchedType]);

  const onSubmit = async (data: EntityAttribute) => {
    if (!service || !entity) {
      setError('Service and entity names are required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Clean the data by removing NaN values and undefined optional fields
      const cleanedData = { ...data };
      
      // Remove NaN values for numeric fields
      const numericFields = ['minLength', 'maxLength', 'minimum', 'maximum', 'precision', 'scale'];
      numericFields.forEach(field => {
        if (cleanedData[field as keyof EntityAttribute] !== undefined) {
          const value = cleanedData[field as keyof EntityAttribute] as number;
          if (isNaN(value) || value === null) {
            delete cleanedData[field as keyof EntityAttribute];
          }
        }
      });

      // Remove empty string values for optional string fields
      const optionalStringFields = ['pattern', 'format', 'defaultValue'];
      optionalStringFields.forEach(field => {
        if (cleanedData[field as keyof EntityAttribute] === '') {
          delete cleanedData[field as keyof EntityAttribute];
        }
      });

      // Remove empty arrays
      if (cleanedData.examples && cleanedData.examples.length === 0) {
        delete cleanedData.examples;
      }
      if (cleanedData.enumValues && cleanedData.enumValues.length === 0) {
        delete cleanedData.enumValues;
      }

      // If onSave prop is provided, use it
      if (onSave) {
        await onSave(cleanedData);
      } else {
        // Otherwise, fetch the entity, update it, and save it back
        const response = await servicesApi.getEntitySchema(service, entity);
        const entityData = response.data;

        if (isEdit) {
          // Update existing attribute
          const index = entityData.attributes.findIndex((attr: EntityAttribute) => attr.name === cleanedData.name);
          if (index !== -1) {
            entityData.attributes[index] = cleanedData;
          } else {
            throw new Error('Attribute not found');
          }
        } else {
          // Add new attribute
          entityData.attributes.push(cleanedData);
        }

        await servicesApi.updateEntity(service, entity, entityData);
      }

      // Navigate back to entity detail page
      navigate(`/services/${service}/entities/${entity}`);
    } catch (err) {
      console.error('Error saving attribute:', err);
      setError('Failed to save attribute. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title text-2xl mb-6">
          {isEdit ? 'Edit Attribute' : 'Create New Attribute'}
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
                <span className="label-text">Type</span>
              </label>
              <select
                className={`select select-bordered ${errors.type ? 'select-error' : ''}`}
                {...register('type', { required: 'Type is required' })}
              >
                {Object.values(AttributeType).map(type => (
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
              <label className="label cursor-pointer">
                <span className="label-text">Unique</span>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  {...register('unique')}
                />
              </label>
            </div>

            {/* Type-specific fields */}
            {(selectedType === AttributeType.STRING) && (
              <>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Min Length</span>
                  </label>
                  <input
                    type="number"
                    className="input input-bordered"
                    {...register('minLength', { valueAsNumber: true })}
                  />
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Max Length</span>
                  </label>
                  <input
                    type="number"
                    className="input input-bordered"
                    {...register('maxLength', { valueAsNumber: true })}
                  />
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Pattern (Regex)</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered"
                    {...register('pattern')}
                  />
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Format</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered"
                    placeholder="e.g., email, uri, uuid"
                    {...register('format')}
                  />
                </div>
              </>
            )}

            {(selectedType === AttributeType.NUMBER || selectedType === AttributeType.INTEGER) && (
              <>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Minimum</span>
                  </label>
                  <input
                    type="number"
                    className="input input-bordered"
                    {...register('minimum', { valueAsNumber: true })}
                  />
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Maximum</span>
                  </label>
                  <input
                    type="number"
                    className="input input-bordered"
                    {...register('maximum', { valueAsNumber: true })}
                  />
                </div>

                {selectedType === AttributeType.NUMBER && (
                  <>
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text">Precision</span>
                      </label>
                      <input
                        type="number"
                        className="input input-bordered"
                        {...register('precision', { valueAsNumber: true })}
                      />
                    </div>

                    <div className="form-control">
                      <label className="label">
                        <span className="label-text">Scale</span>
                      </label>
                      <input
                        type="number"
                        className="input input-bordered"
                        {...register('scale', { valueAsNumber: true })}
                      />
                    </div>
                  </>
                )}
              </>
            )}

            {selectedType === AttributeType.ENUM && (
              <div className="form-control md:col-span-2">
                <label className="label">
                  <span className="label-text">Enum Values (comma-separated)</span>
                </label>
                <Controller
                  name="enumValues"
                  control={control}
                  defaultValue={[]}
                  render={({ field }) => (
                    <input
                      type="text"
                      className="input input-bordered"
                      value={(field.value || []).join(', ')}
                      onChange={(e) => {
                        const values = e.target.value.split(',').map(v => v.trim()).filter(Boolean);
                        field.onChange(values);
                      }}
                    />
                  )}
                />
              </div>
            )}

            {/* Default value */}
            <div className="form-control md:col-span-2">
              <label className="label">
                <span className="label-text">Default Value</span>
              </label>
              <input
                type="text"
                className="input input-bordered"
                {...register('defaultValue')}
              />
            </div>

            {/* Examples */}
            <div className="form-control md:col-span-2">
              <label className="label">
                <span className="label-text">Examples (comma-separated)</span>
              </label>
              <Controller
                name="examples"
                control={control}
                defaultValue={[]}
                render={({ field }) => (
                  <input
                    type="text"
                    className="input input-bordered"
                    value={(field.value || []).join(', ')}
                    onChange={(e) => {
                      const values = e.target.value.split(',').map(v => v.trim()).filter(Boolean);
                      field.onChange(values);
                    }}
                  />
                )}
              />
            </div>
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
                'Save Attribute'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AttributeEditor;