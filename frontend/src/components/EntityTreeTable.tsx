import { useEffect, useState } from 'react';
import { entityApi, servicesApi, relationshipApi } from '../services/api';
import { Package, Entity, Attribute, AttributeType, Relationship, Cardinality } from '../types';
import RelationshipEditor from './RelationshipEditor';

interface ExpandedState {
  [key: string]: boolean;
}

const EntityTreeTable = () => {
  const [packages, setPackages] = useState<Package[]>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [isAddPackageModalOpen, setIsAddPackageModalOpen] = useState(false);
  const [isEditPackageModalOpen, setIsEditPackageModalOpen] = useState(false);
  const [isDeletePackageModalOpen, setIsDeletePackageModalOpen] = useState(false);
  const [isAddEntityModalOpen, setIsAddEntityModalOpen] = useState(false);
  const [isEditEntityModalOpen, setIsEditEntityModalOpen] = useState(false);
  const [isDeleteEntityModalOpen, setIsDeleteEntityModalOpen] = useState(false);
  const [isAddAttributeModalOpen, setIsAddAttributeModalOpen] = useState(false);
  const [isEditAttributeModalOpen, setIsEditAttributeModalOpen] = useState(false);
  const [isDeleteAttributeModalOpen, setIsDeleteAttributeModalOpen] = useState(false);
  const [isAddRelationshipModalOpen, setIsAddRelationshipModalOpen] = useState(false);
  const [isEditRelationshipModalOpen, setIsEditRelationshipModalOpen] = useState(false);
  const [isDeleteRelationshipModalOpen, setIsDeleteRelationshipModalOpen] = useState(false);

  // Current selected items
  const [currentPackage, setCurrentPackage] = useState<Package | null>(null);
  const [currentEntity, setCurrentEntity] = useState<Entity | null>(null);
  const [currentAttribute, setCurrentAttribute] = useState<Attribute | null>(null);
  const [currentRelationship, setCurrentRelationship] = useState<Relationship | null>(null);
  const [parentPackageId, setParentPackageId] = useState<string | null>(null);
  const [availableEntities, setAvailableEntities] = useState<string[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);

  // Form states
  const [newPackage, setNewPackage] = useState<Partial<Package>>({
    name: '',
    description: '',
    metadata: []
  });

  const [newEntity, setNewEntity] = useState<Partial<Entity>>({
    name: '',
    description: '',
    attributes: []
  });

  const [newAttribute, setNewAttribute] = useState<Partial<Attribute>>({
    name: '',
    description: '',
    type: AttributeType.STRING,
    required: false
  });

  const [newRelationship, setNewRelationship] = useState<Partial<Relationship>>({
    description: '',
    source: { entity: '', cardinality: Cardinality.ONE },
    target: { entity: '', cardinality: Cardinality.ONE }
  });

  // Fetch packages
  const fetchPackages = async () => {
    setLoading(true);
    setError(null);
    try {
      const pkgs: Package[] = await entityApi.getAllPackages();
      setPackages(pkgs);
      // Expand all packages by default
      const initialExpanded: ExpandedState = {};
      const markPackages = (pkgs: Package[]) => {
        pkgs.forEach(pkg => {
          initialExpanded['pkg-' + pkg.id] = true;
          if (pkg.subPackages) markPackages(pkg.subPackages);
        });
      };
      markPackages(pkgs);
      setExpanded(initialExpanded);
    } catch (err) {
      setError('Failed to load hierarchy. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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

    // Check if this entity name exists in multiple services
    if (availableEntities.length === 0) return entityName; // Default to just entity name if no data

    const entitiesWithSameName = availableEntities.filter(e => {
      const parts = e.split('/');
      return parts[1] === entityName;
    });

    // If no ambiguity (entity name only exists in one service), return only the entity name
    return entitiesWithSameName.length <= 1 ? entityName : `${service}${separator}${entityName}`;
  };

  // Find entity name by UUID across all packages
  const findEntityNameByUuid = (uuid: string): string => {
    const search = (pkgs: Package[]): string | null => {
      for (const pkg of pkgs) {
        if (pkg.entities) {
          const entity = pkg.entities.find(e => e.uuid === uuid);
          if (entity) return entity.name;
        }
        if (pkg.subPackages) {
          const found = search(pkg.subPackages);
          if (found) return found;
        }
      }
      return null;
    };
    return search(packages) || uuid;
  };

  // Format cardinality display
  const formatCardinality = (rel: Relationship): string => {
    const sourceCard = rel.source.cardinality === Cardinality.MANY ? '*' : '1';
    const targetCard = rel.target.cardinality === Cardinality.MANY ? '*' : '1';
    return `${sourceCard}..${targetCard}`;
  };

  useEffect(() => {
    fetchPackages();
    fetchAvailableEntities();
  }, []);

  // Fetch available entities for relationship target dropdown
  const fetchAvailableEntities = async () => {
    try {
      setLoadingEntities(true);
      // Get all services
      const servicesResponse = await servicesApi.getAllServices();
      const allServices = servicesResponse.data;

      // For each service, get its entities
      const allEntities: string[] = [];
      for (const service of allServices) {
        const entitiesResponse = await servicesApi.getServiceEntities(service);
        const entities = entitiesResponse.data.map((e: any) => `${service}/${e.name}`);
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

  // Handle package operations
  const handleAddPackage = async () => {
    if (!newPackage.name) {
      setError('Package name is required');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Generate a UUID for the new package
      const uuid = crypto.randomUUID();
      const packageToCreate: Package = {
        ...newPackage as Package,
        id: uuid,
        parentId: parentPackageId || undefined
      };

      // API call would go here - for now we'll simulate it
      // await packageApi.createPackage(packageToCreate);

      // For now, let's update the state directly
      if (parentPackageId) {
        // Add as subpackage
        setPackages(prevPackages => {
          const updateSubPackages = (pkgs: Package[]): Package[] => {
            return pkgs.map(pkg => {
              if (pkg.id === parentPackageId) {
                return {
                  ...pkg,
                  subPackages: [...(pkg.subPackages || []), packageToCreate]
                };
              } else if (pkg.subPackages && pkg.subPackages.length > 0) {
                return {
                  ...pkg,
                  subPackages: updateSubPackages(pkg.subPackages)
                };
              }
              return pkg;
            });
          };
          return updateSubPackages(prevPackages);
        });
      } else {
        // Add as top-level package
        setPackages(prevPackages => [...prevPackages, packageToCreate]);
      }

      setIsAddPackageModalOpen(false);
      setNewPackage({
        name: '',
        description: '',
        metadata: []
      });
      setParentPackageId(null);
    } catch (err) {
      console.error('Error creating package:', err);
      setError('Failed to create package. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEditPackage = async () => {
    if (!currentPackage || !currentPackage.name) {
      setError('Package name is required');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // API call would go here - for now we'll simulate it
      // await packageApi.updatePackage(currentPackage.id, currentPackage);

      // For now, let's update the state directly
      setPackages(prevPackages => {
        const updatePackages = (pkgs: Package[]): Package[] => {
          return pkgs.map(pkg => {
            if (pkg.id === currentPackage.id) {
              return currentPackage;
            } else if (pkg.subPackages && pkg.subPackages.length > 0) {
              return {
                ...pkg,
                subPackages: updatePackages(pkg.subPackages)
              };
            }
            return pkg;
          });
        };
        return updatePackages(prevPackages);
      });

      setIsEditPackageModalOpen(false);
      setCurrentPackage(null);
    } catch (err) {
      console.error('Error updating package:', err);
      setError('Failed to update package. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePackage = async () => {
    if (!currentPackage) return;

    setLoading(true);
    setError(null);
    try {
      // API call would go here - for now we'll simulate it
      // await packageApi.deletePackage(currentPackage.id);

      // For now, let's update the state directly
      setPackages(prevPackages => {
        const removePackage = (pkgs: Package[]): Package[] => {
          return pkgs.filter(pkg => {
            if (pkg.id === currentPackage.id) {
              return false;
            } else if (pkg.subPackages && pkg.subPackages.length > 0) {
              pkg.subPackages = removePackage(pkg.subPackages);
            }
            return true;
          });
        };
        return removePackage(prevPackages);
      });

      setIsDeletePackageModalOpen(false);
      setCurrentPackage(null);
    } catch (err) {
      console.error('Error deleting package:', err);
      setError('Failed to delete package. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Handle entity operations
  const handleAddEntity = async () => {
    if (!newEntity.name || !currentPackage) {
      setError('Entity name is required');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Generate a UUID for the new entity
      const uuid = crypto.randomUUID();
      const entityToCreate: Entity = {
        uuid,
        name: newEntity.name || '',
        description: newEntity.description || '',
        attributes: []
      };

      await servicesApi.createEntity(currentPackage.name, entityToCreate);

      // Update the state
      setPackages(prevPackages => {
        const updatePackages = (pkgs: Package[]): Package[] => {
          return pkgs.map(pkg => {
            if (pkg.id === currentPackage.id) {
              return {
                ...pkg,
                entities: [...(pkg.entities || []), entityToCreate]
              };
            } else if (pkg.subPackages && pkg.subPackages.length > 0) {
              return {
                ...pkg,
                subPackages: updatePackages(pkg.subPackages)
              };
            }
            return pkg;
          });
        };
        return updatePackages(prevPackages);
      });

      setIsAddEntityModalOpen(false);
      setNewEntity({
        name: '',
        description: '',
        attributes: []
      });
    } catch (err) {
      console.error('Error creating entity:', err);
      setError('Failed to create entity. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEditEntity = async () => {
    if (!currentEntity || !currentPackage) return;

    setLoading(true);
    setError(null);
    try {
      await servicesApi.updateEntity(currentPackage.name, currentEntity.name, currentEntity);

      // Update the state
      setPackages(prevPackages => {
        const updateEntities = (pkgs: Package[]): Package[] => {
          return pkgs.map(pkg => {
            if (pkg.entities) {
              pkg.entities = pkg.entities.map(entity =>
                entity.uuid === currentEntity.uuid ? currentEntity : entity
              );
            }
            if (pkg.subPackages && pkg.subPackages.length > 0) {
              pkg.subPackages = updateEntities(pkg.subPackages);
            }
            return pkg;
          });
        };
        return updateEntities(prevPackages);
      });

      setIsEditEntityModalOpen(false);
      setCurrentEntity(null);
    } catch (err) {
      console.error('Error updating entity:', err);
      setError('Failed to update entity. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEntity = async () => {
    if (!currentEntity || !currentPackage) return;

    setLoading(true);
    setError(null);
    try {
      await servicesApi.deleteEntity(currentPackage.name, currentEntity.name);

      // Update the state
      setPackages(prevPackages => {
        const removeEntity = (pkgs: Package[]): Package[] => {
          return pkgs.map(pkg => {
            if (pkg.entities) {
              pkg.entities = pkg.entities.filter(entity =>
                entity.uuid !== currentEntity.uuid
              );
            }
            if (pkg.subPackages && pkg.subPackages.length > 0) {
              pkg.subPackages = removeEntity(pkg.subPackages);
            }
            return pkg;
          });
        };
        return removeEntity(prevPackages);
      });

      setIsDeleteEntityModalOpen(false);
      setCurrentEntity(null);
    } catch (err) {
      console.error('Error deleting entity:', err);
      setError('Failed to delete entity. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle attribute operations
  const handleAddAttribute = async () => {
    if (!newAttribute.name || !currentEntity || !currentPackage) {
      setError('Attribute name is required');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Generate a UUID for the new attribute
      const uuid = crypto.randomUUID();
      const attributeToCreate: Attribute = {
        uuid,
        name: newAttribute.name || '',
        description: newAttribute.description || '',
        type: newAttribute.type || AttributeType.STRING,
        required: newAttribute.required || false,
        primaryKey: newAttribute.primaryKey || false,
        constraints: newAttribute.constraints
      };

      // Add attribute to entity
      const updatedEntity: Entity = {
        ...currentEntity,
        attributes: [...currentEntity.attributes, attributeToCreate]
      };

      await servicesApi.updateEntity(currentPackage.name, updatedEntity.name, updatedEntity);

      // Update the state
      setPackages(prevPackages => {
        const updateEntities = (pkgs: Package[]): Package[] => {
          return pkgs.map(pkg => {
            if (pkg.entities) {
              pkg.entities = pkg.entities.map(entity =>
                entity.uuid === currentEntity.uuid ? updatedEntity : entity
              );
            }
            if (pkg.subPackages && pkg.subPackages.length > 0) {
              pkg.subPackages = updateEntities(pkg.subPackages);
            }
            return pkg;
          });
        };
        return updateEntities(prevPackages);
      });

      setIsAddAttributeModalOpen(false);
      setNewAttribute({
        name: '',
        description: '',
        type: AttributeType.STRING,
        required: false
      });
    } catch (err) {
      console.error('Error adding attribute:', err);
      setError('Failed to add attribute. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEditAttribute = async () => {
    if (!currentAttribute || !currentEntity || !currentPackage) return;

    setLoading(true);
    setError(null);
    try {
      // Update attribute in entity
      const updatedEntity: Entity = {
        ...currentEntity,
        attributes: currentEntity.attributes.map(attr =>
          attr.uuid === currentAttribute.uuid ? currentAttribute : attr
        )
      };

      await servicesApi.updateEntity(currentPackage.name, updatedEntity.name, updatedEntity);

      // Update the state
      setPackages(prevPackages => {
        const updateEntities = (pkgs: Package[]): Package[] => {
          return pkgs.map(pkg => {
            if (pkg.entities) {
              pkg.entities = pkg.entities.map(entity =>
                entity.uuid === currentEntity.uuid ? updatedEntity : entity
              );
            }
            if (pkg.subPackages && pkg.subPackages.length > 0) {
              pkg.subPackages = updateEntities(pkg.subPackages);
            }
            return pkg;
          });
        };
        return updateEntities(prevPackages);
      });

      setIsEditAttributeModalOpen(false);
      setCurrentAttribute(null);
    } catch (err) {
      console.error('Error updating attribute:', err);
      setError('Failed to update attribute. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAttribute = async () => {
    if (!currentAttribute || !currentEntity || !currentPackage) return;

    setLoading(true);
    setError(null);
    try {
      // Remove attribute from entity
      const updatedEntity: Entity = {
        ...currentEntity,
        attributes: currentEntity.attributes.filter(attr =>
          attr.uuid !== currentAttribute.uuid
        )
      };

      await servicesApi.updateEntity(currentPackage.name, updatedEntity.name, updatedEntity);

      // Update the state
      setPackages(prevPackages => {
        const updateEntities = (pkgs: Package[]): Package[] => {
          return pkgs.map(pkg => {
            if (pkg.entities) {
              pkg.entities = pkg.entities.map(entity =>
                entity.uuid === currentEntity.uuid ? updatedEntity : entity
              );
            }
            if (pkg.subPackages && pkg.subPackages.length > 0) {
              pkg.subPackages = updateEntities(pkg.subPackages);
            }
            return pkg;
          });
        };
        return updateEntities(prevPackages);
      });

      setIsDeleteAttributeModalOpen(false);
      setCurrentAttribute(null);
    } catch (err) {
      console.error('Error deleting attribute:', err);
      setError('Failed to delete attribute. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle relationship operations (now at package level)
  const handleAddRelationship = async () => {
    if (!currentPackage) return;

    setLoading(true);
    setError(null);
    try {
      // Generate a UUID for the new relationship
      const uuid = crypto.randomUUID();
      const relationshipToCreate: Relationship = {
        uuid,
        description: newRelationship.description || '',
        source: {
          entity: newRelationship.source?.entity || '',
          cardinality: newRelationship.source?.cardinality || Cardinality.ONE,
          name: newRelationship.source?.name
        },
        target: {
          entity: newRelationship.target?.entity || '',
          cardinality: newRelationship.target?.cardinality || Cardinality.ONE,
          name: newRelationship.target?.name
        }
      };

      await relationshipApi.createRelationship(currentPackage.name, relationshipToCreate);

      // Update the state - add relationship to package
      setPackages(prevPackages => {
        const updatePackages = (pkgs: Package[]): Package[] => {
          return pkgs.map(pkg => {
            if (pkg.id === currentPackage.id) {
              return {
                ...pkg,
                relationships: [...(pkg.relationships || []), relationshipToCreate]
              };
            }
            if (pkg.subPackages && pkg.subPackages.length > 0) {
              return {
                ...pkg,
                subPackages: updatePackages(pkg.subPackages)
              };
            }
            return pkg;
          });
        };
        return updatePackages(prevPackages);
      });

      setIsAddRelationshipModalOpen(false);
      setNewRelationship({
        description: '',
        source: { entity: '', cardinality: Cardinality.ONE },
        target: { entity: '', cardinality: Cardinality.ONE }
      });
    } catch (err) {
      console.error('Error adding relationship:', err);
      setError('Failed to add relationship. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEditRelationship = async () => {
    if (!currentRelationship || !currentPackage) return;

    setLoading(true);
    setError(null);
    try {
      await relationshipApi.updateRelationship(currentPackage.name, currentRelationship.uuid, currentRelationship);

      // Update the state
      setPackages(prevPackages => {
        const updatePackages = (pkgs: Package[]): Package[] => {
          return pkgs.map(pkg => {
            if (pkg.id === currentPackage.id) {
              return {
                ...pkg,
                relationships: (pkg.relationships || []).map(rel =>
                  rel.uuid === currentRelationship.uuid ? currentRelationship : rel
                )
              };
            }
            if (pkg.subPackages && pkg.subPackages.length > 0) {
              return {
                ...pkg,
                subPackages: updatePackages(pkg.subPackages)
              };
            }
            return pkg;
          });
        };
        return updatePackages(prevPackages);
      });

      setIsEditRelationshipModalOpen(false);
      setCurrentRelationship(null);
    } catch (err) {
      console.error('Error updating relationship:', err);
      setError('Failed to update relationship. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRelationship = async () => {
    if (!currentRelationship || !currentPackage) return;

    setLoading(true);
    setError(null);
    try {
      await relationshipApi.deleteRelationship(currentPackage.name, currentRelationship.uuid);

      // Update the state
      setPackages(prevPackages => {
        const updatePackages = (pkgs: Package[]): Package[] => {
          return pkgs.map(pkg => {
            if (pkg.id === currentPackage.id) {
              return {
                ...pkg,
                relationships: (pkg.relationships || []).filter(rel =>
                  rel.uuid !== currentRelationship.uuid
                )
              };
            }
            if (pkg.subPackages && pkg.subPackages.length > 0) {
              return {
                ...pkg,
                subPackages: updatePackages(pkg.subPackages)
              };
            }
            return pkg;
          });
        };
        return updatePackages(prevPackages);
      });

      setIsDeleteRelationshipModalOpen(false);
      setCurrentRelationship(null);
    } catch (err) {
      console.error('Error deleting relationship:', err);
      setError('Failed to delete relationship. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRelationshipChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    if (currentRelationship) {
      if (name === 'sourceEntity') {
        setCurrentRelationship({ ...currentRelationship, source: { ...currentRelationship.source, entity: value } });
      } else if (name === 'sourceCardinality') {
        setCurrentRelationship({ ...currentRelationship, source: { ...currentRelationship.source, cardinality: value as Cardinality } });
      } else if (name === 'sourceName') {
        setCurrentRelationship({ ...currentRelationship, source: { ...currentRelationship.source, name: value } });
      } else if (name === 'targetEntity') {
        setCurrentRelationship({ ...currentRelationship, target: { ...currentRelationship.target, entity: value } });
      } else if (name === 'targetCardinality') {
        setCurrentRelationship({ ...currentRelationship, target: { ...currentRelationship.target, cardinality: value as Cardinality } });
      } else if (name === 'targetName') {
        setCurrentRelationship({ ...currentRelationship, target: { ...currentRelationship.target, name: value } });
      } else if (name === 'description') {
        setCurrentRelationship({ ...currentRelationship, description: value });
      }
    } else {
      if (name === 'sourceEntity') {
        setNewRelationship({ ...newRelationship, source: { ...newRelationship.source!, entity: value, cardinality: newRelationship.source?.cardinality || Cardinality.ONE } });
      } else if (name === 'sourceCardinality') {
        setNewRelationship({ ...newRelationship, source: { ...newRelationship.source!, entity: newRelationship.source?.entity || '', cardinality: value as Cardinality } });
      } else if (name === 'sourceName') {
        setNewRelationship({ ...newRelationship, source: { ...newRelationship.source!, entity: newRelationship.source?.entity || '', cardinality: newRelationship.source?.cardinality || Cardinality.ONE, name: value } });
      } else if (name === 'targetEntity') {
        setNewRelationship({ ...newRelationship, target: { ...newRelationship.target!, entity: value, cardinality: newRelationship.target?.cardinality || Cardinality.ONE } });
      } else if (name === 'targetCardinality') {
        setNewRelationship({ ...newRelationship, target: { ...newRelationship.target!, entity: newRelationship.target?.entity || '', cardinality: value as Cardinality } });
      } else if (name === 'targetName') {
        setNewRelationship({ ...newRelationship, target: { ...newRelationship.target!, entity: newRelationship.target?.entity || '', cardinality: newRelationship.target?.cardinality || Cardinality.ONE, name: value } });
      } else if (name === 'description') {
        setNewRelationship({ ...newRelationship, description: value });
      }
    }
  };

  // Handle input changes
  const handlePackageChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (currentPackage) {
      setCurrentPackage({ ...currentPackage, [name]: value });
    } else {
      setNewPackage({ ...newPackage, [name]: value });
    }
  };

  const handleEntityChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (currentEntity) {
      setCurrentEntity({ ...currentEntity, [name]: value });
    } else {
      setNewEntity({ ...newEntity, [name]: value });
    }
  };

  const handleAttributeChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const newValue = name === 'required' || name === 'primaryKey' ? (value === 'true') : value;

    if (currentAttribute) {
      setCurrentAttribute({ ...currentAttribute, [name]: newValue });
    } else {
      setNewAttribute({ ...newAttribute, [name]: newValue });
    }
  };

  // Recursive render for package/entity/attribute hierarchy
  const renderRows = (
    pkgs: Package[],
    level = 0
  ): React.ReactNode[] => {
    let rows: React.ReactNode[] = [];
    pkgs.forEach(pkg => {
      const pkgId = 'pkg-' + pkg.id;
      rows.push(
        <tr key={pkgId}>
          <td style={{ paddingLeft: `${level * 24}px` }}>
            <button
              className="btn btn-xs btn-ghost"
              onClick={() => toggleExpand(pkgId)}
              aria-label={expanded[pkgId] ? 'Collapse' : 'Expand'}
              type="button"
            >
              {expanded[pkgId] ? '\u25BC' : '\u25B6'}
            </button>
            <span className="font-semibold ml-1">
              <svg xmlns="http://www.w3.org/2000/svg" className="inline-block h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />
              </svg>
              {pkg.name}
            </span>
          </td>
          <td>{pkg.description || '-'}</td>
          <td>-</td>
          <td>-</td>
          <td className="text-right">
            <div className="flex justify-end space-x-1">
              <button
                className="btn btn-xs btn-outline"
                onClick={() => {
                  setCurrentPackage(pkg);
                  setIsAddEntityModalOpen(true);
                }}
                title="Add"
                type="button"
              >{'\uFF0B'}</button>
              <button
                className="btn btn-xs btn-ghost"
                onClick={() => {
                  setCurrentPackage(pkg);
                  setIsEditPackageModalOpen(true);
                }}
                title="Edit Package"
                type="button"
              >{'\u270E'}</button>
              <button
                className="btn btn-xs btn-outline btn-error"
                onClick={() => {
                  setCurrentPackage(pkg);
                  setIsDeletePackageModalOpen(true);
                }}
                title="Delete Package"
                type="button"
              >{'\uD83D\uDDD1\uFE0F'}</button>
              <div className="dropdown dropdown-end">
                <label tabIndex={0} className="btn btn-xs btn-ghost">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                  </svg>
                </label>
                <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
                  <li>
                    <button
                      onClick={() => {
                        setCurrentPackage(pkg);
                        setIsAddEntityModalOpen(true);
                      }}
                      title="Add Entity"
                    >
                      <span className="font-mono">+</span> Add Entity
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => {
                        setParentPackageId(pkg.id);
                        setIsAddPackageModalOpen(true);
                      }}
                      title="Add Subpackage"
                    >
                      <span className="font-mono">+</span> Add Subpackage
                    </button>
                  </li>
                  <li>
                    <button
                      onClick={() => {
                        setCurrentPackage(pkg);
                        setIsAddRelationshipModalOpen(true);
                      }}
                      title="Add Relationship"
                    >
                      <span className="font-mono">+</span> Add Relationship
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </td>
        </tr>
      );
      if (expanded[pkgId]) {
        // Entities
        if (pkg.entities) {
          pkg.entities.forEach(entity => {
            const entityId = 'entity-' + entity.uuid;
            rows.push(
              <tr key={entityId}>
                <td style={{ paddingLeft: `${(level + 1) * 24}px` }}>
                  <button
                    className="btn btn-xs btn-ghost"
                    onClick={() => toggleExpand(entityId)}
                    aria-label={expanded[entityId] ? 'Collapse' : 'Expand'}
                    type="button"
                  >
                    {entity.attributes && entity.attributes.length > 0
                      ? expanded[entityId] ? '\u25BC' : '\u25B6'
                      : ''}
                  </button>
                  <span className="ml-1">
                    <svg xmlns="http://www.w3.org/2000/svg" className="inline-block h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3z" />
                    </svg>
                    {entity.name}
                  </span>
                </td>
                <td>{entity.description || '-'}</td>
                <td>-</td>
                <td>-</td>
                <td className="text-right">
                  <div className="flex justify-end space-x-1">
                    <button
                      className="btn btn-xs btn-outline"
                      onClick={() => {
                        setCurrentEntity(entity);
                        setCurrentPackage(pkg);
                        setIsAddAttributeModalOpen(true);
                      }}
                      title="Add"
                      type="button"
                    >{'\uFF0B'}</button>
                    <button
                      className="btn btn-xs btn-ghost"
                      onClick={() => {
                        setCurrentEntity(entity);
                        setCurrentPackage(pkg);
                        setIsEditEntityModalOpen(true);
                      }}
                      title="Edit Entity"
                      type="button"
                    >{'\u270E'}</button>
                    <button
                      className="btn btn-xs btn-outline btn-error"
                      onClick={() => {
                        setCurrentEntity(entity);
                        setCurrentPackage(pkg);
                        setIsDeleteEntityModalOpen(true);
                      }}
                      title="Delete Entity"
                      type="button"
                    >{'\uD83D\uDDD1\uFE0F'}</button>
                    <div className="dropdown dropdown-end">
                      <label tabIndex={0} className="btn btn-xs btn-ghost">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                        </svg>
                      </label>
                      <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
                        <li>
                          <button
                            onClick={() => {
                              setCurrentEntity(entity);
                              setCurrentPackage(pkg);
                              setIsAddAttributeModalOpen(true);
                            }}
                            title="Add Attribute"
                          >
                            <span className="font-mono">+</span> Add Attribute
                          </button>
                        </li>
                      </ul>
                    </div>
                  </div>
                </td>
              </tr>
            );
            // Attributes
            if (entity.attributes && entity.attributes.length > 0 && expanded[entityId]) {
              entity.attributes.forEach(attr => {
                rows.push(
                  <tr key={entityId + '-attr-' + attr.uuid}>
                    <td style={{ paddingLeft: `${(level + 2) * 24}px` }}>
                      <span className="ml-6">
                        <svg xmlns="http://www.w3.org/2000/svg" className="inline-block h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                        {attr.name}
                        {attr.primaryKey && <span className="badge badge-xs badge-warning ml-1">PK</span>}
                      </span>
                    </td>
                    <td>{attr.description || '-'}</td>
                    <td>{attr.type}</td>
                    <td>
                      {attr.required ? 'Required' : ''}
                      {attr.constraints?.minLength !== undefined && ` min:${attr.constraints.minLength}`}
                      {attr.constraints?.maxLength !== undefined && ` max:${attr.constraints.maxLength}`}
                      {attr.constraints?.pattern && ` pattern`}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end space-x-1">
                        <button
                          className="btn btn-xs btn-ghost"
                          onClick={() => {
                            setCurrentAttribute(attr);
                            setCurrentEntity(entity);
                            setCurrentPackage(pkg);
                            setIsEditAttributeModalOpen(true);
                          }}
                          title="Edit Attribute"
                          type="button"
                        >{'\u270E'}</button>
                        <button
                          className="btn btn-xs btn-outline btn-error"
                          onClick={() => {
                            setCurrentAttribute(attr);
                            setCurrentEntity(entity);
                            setCurrentPackage(pkg);
                            setIsDeleteAttributeModalOpen(true);
                          }}
                          title="Delete Attribute"
                          type="button"
                        >{'\uD83D\uDDD1\uFE0F'}</button>
                        <div className="dropdown dropdown-end">
                          <label tabIndex={0} className="btn btn-xs btn-ghost">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                            </svg>
                          </label>
                          <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
                            <li>
                              <button
                                onClick={() => {
                                  // Placeholder for future attribute actions
                                  console.log(`Actions for attribute: ${attr.name}`);
                                }}
                              >
                                <span className="font-mono">i</span> Attribute Info
                              </button>
                            </li>
                          </ul>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              });
            }
          });
        }
        // Relationships (now at package level)
        if (pkg.relationships && pkg.relationships.length > 0) {
          pkg.relationships.forEach(rel => {
            const relationshipId = `${pkgId}-rel-${rel.uuid}`;

            // Get cardinality-based icon
            const getRelationshipIcon = (rel: Relationship) => {
              const isOneToOne = rel.source.cardinality === Cardinality.ONE && rel.target.cardinality === Cardinality.ONE;
              const isOneToMany = rel.source.cardinality === Cardinality.ONE && rel.target.cardinality === Cardinality.MANY;
              const isManyToOne = rel.source.cardinality === Cardinality.MANY && rel.target.cardinality === Cardinality.ONE;
              const isManyToMany = rel.source.cardinality === Cardinality.MANY && rel.target.cardinality === Cardinality.MANY;

              if (isOneToOne) {
                return (
                  <svg xmlns="http://www.w3.org/2000/svg" className="inline-block h-4 w-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                  </svg>
                );
              } else if (isOneToMany) {
                return (
                  <svg xmlns="http://www.w3.org/2000/svg" className="inline-block h-4 w-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                    <line x1="16" y1="8" x2="16" y2="16" strokeWidth="4"></line>
                  </svg>
                );
              } else if (isManyToOne) {
                return (
                  <svg xmlns="http://www.w3.org/2000/svg" className="inline-block h-4 w-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <circle cx="5" cy="12" r="3" fill="white"></circle>
                  </svg>
                );
              } else if (isManyToMany) {
                return (
                  <svg xmlns="http://www.w3.org/2000/svg" className="inline-block h-4 w-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <line x1="5" y1="8" x2="5" y2="16" strokeWidth="4"></line>
                    <line x1="19" y1="8" x2="19" y2="16" strokeWidth="4"></line>
                  </svg>
                );
              }
              return (
                <svg xmlns="http://www.w3.org/2000/svg" className="inline-block h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 015.656 0l4 4a4 4 0 01-5.656 5.656l-1.102-1.101" />
                </svg>
              );
            };

            const sourceName = findEntityNameByUuid(rel.source.entity);
            const targetName = findEntityNameByUuid(rel.target.entity);

            rows.push(
              <tr key={relationshipId}>
                <td style={{ paddingLeft: `${(level + 1) * 24}px` }}>
                  <span className="ml-6">
                    {getRelationshipIcon(rel)}
                    <span className="font-medium">{sourceName} {'\u2192'} {targetName}</span>
                  </span>
                </td>
                <td>{rel.description || '-'}</td>
                <td>
                  <span className="text-sm text-gray-500">{formatCardinality(rel)}</span>
                </td>
                <td>-</td>
                <td className="text-right">
                  <div className="flex justify-end space-x-1">
                    <button
                      className="btn btn-xs btn-ghost"
                      onClick={() => {
                        setCurrentRelationship(rel);
                        setCurrentPackage(pkg);
                        setIsEditRelationshipModalOpen(true);
                      }}
                      title="Edit Relationship"
                      type="button"
                    >{'\u270E'}</button>
                    <button
                      className="btn btn-xs btn-outline btn-error"
                      onClick={() => {
                        setCurrentRelationship(rel);
                        setCurrentPackage(pkg);
                        setIsDeleteRelationshipModalOpen(true);
                      }}
                      title="Delete Relationship"
                      type="button"
                    >{'\uD83D\uDDD1\uFE0F'}</button>
                  </div>
                </td>
              </tr>
            );
          });
        }
        // Sub-packages
        if (pkg.subPackages && pkg.subPackages.length > 0) {
          rows = rows.concat(renderRows(pkg.subPackages, level + 1));
        }
      }
    });
    return rows;
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex-1 flex flex-col min-h-0">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-lg font-semibold">Package / Entity / Attribute Hierarchy</h1>
        <button
          className="btn btn-primary"
          onClick={() => {
            setParentPackageId(null);
            setIsAddPackageModalOpen(true);
          }}
        >
          Add Package
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : (
        <div className="overflow-x-auto bg-base-100 rounded-lg shadow p-1 flex-1 min-h-0">
          <table className="table table-zebra w-full">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Attr Type</th>
                <th>Rule</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {renderRows(packages)}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Package Modal */}
      {isAddPackageModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {parentPackageId ? 'Add Subpackage' : 'Add Package'}
            </h2>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Name</span>
              </label>
              <input
                type="text"
                name="name"
                className="input input-bordered"
                value={newPackage.name}
                onChange={handlePackageChange}
                required
              />
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Description</span>
              </label>
              <textarea
                name="description"
                className="textarea textarea-bordered"
                value={newPackage.description}
                onChange={handlePackageChange}
              ></textarea>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsAddPackageModalOpen(false);
                  setParentPackageId(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAddPackage}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Creating...
                  </>
                ) : (
                  'Create'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Package Modal */}
      {isEditPackageModalOpen && currentPackage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Edit Package</h2>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Name</span>
              </label>
              <input
                type="text"
                name="name"
                className="input input-bordered"
                value={currentPackage.name}
                onChange={handlePackageChange}
                required
              />
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Description</span>
              </label>
              <textarea
                name="description"
                className="textarea textarea-bordered"
                value={currentPackage.description}
                onChange={handlePackageChange}
              ></textarea>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsEditPackageModalOpen(false);
                  setCurrentPackage(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleEditPackage}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Updating...
                  </>
                ) : (
                  'Update'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Package Modal */}
      {isDeletePackageModalOpen && currentPackage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Delete Package</h2>

            <p className="mb-4">
              Are you sure you want to delete the package <strong>{currentPackage.name}</strong>?
              {currentPackage.subPackages && currentPackage.subPackages.length > 0 && (
                <span className="text-error"> This will also delete all subpackages.</span>
              )}
              {currentPackage.entities && currentPackage.entities.length > 0 && (
                <span className="text-error"> This will also delete all entities in this package.</span>
              )}
            </p>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsDeletePackageModalOpen(false);
                  setCurrentPackage(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-error"
                onClick={handleDeletePackage}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Entity Modal */}
      {isAddEntityModalOpen && currentPackage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Add Entity to {currentPackage.name}</h2>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Name</span>
              </label>
              <input
                type="text"
                name="name"
                className="input input-bordered"
                value={newEntity.name}
                onChange={handleEntityChange}
                required
              />
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Description</span>
              </label>
              <textarea
                name="description"
                className="textarea textarea-bordered"
                value={newEntity.description}
                onChange={handleEntityChange}
              ></textarea>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsAddEntityModalOpen(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAddEntity}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Creating...
                  </>
                ) : (
                  'Create'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Entity Modal */}
      {isEditEntityModalOpen && currentEntity && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Edit Entity</h2>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Name</span>
              </label>
              <input
                type="text"
                name="name"
                className="input input-bordered"
                value={currentEntity.name}
                onChange={handleEntityChange}
                required
              />
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Description</span>
              </label>
              <textarea
                name="description"
                className="textarea textarea-bordered"
                value={currentEntity.description}
                onChange={handleEntityChange}
              ></textarea>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsEditEntityModalOpen(false);
                  setCurrentEntity(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleEditEntity}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Updating...
                  </>
                ) : (
                  'Update'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Entity Modal */}
      {isDeleteEntityModalOpen && currentEntity && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Delete Entity</h2>

            <p className="mb-4">
              Are you sure you want to delete the entity <strong>{currentEntity.name}</strong>? This action cannot be undone.
            </p>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsDeleteEntityModalOpen(false);
                  setCurrentEntity(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-error"
                onClick={handleDeleteEntity}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Attribute Modal */}
      {isAddAttributeModalOpen && currentEntity && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Add Attribute to {currentEntity.name}</h2>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Name</span>
              </label>
              <input
                type="text"
                name="name"
                className="input input-bordered"
                value={newAttribute.name}
                onChange={handleAttributeChange}
                required
              />
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Description</span>
              </label>
              <textarea
                name="description"
                className="textarea textarea-bordered"
                value={newAttribute.description}
                onChange={handleAttributeChange}
              ></textarea>
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Type</span>
              </label>
              <select
                name="type"
                className="select select-bordered"
                value={newAttribute.type}
                onChange={handleAttributeChange}
              >
                {Object.values(AttributeType).map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Required</span>
              </label>
              <select
                name="required"
                className="select select-bordered"
                value={newAttribute.required ? 'true' : 'false'}
                onChange={handleAttributeChange}
              >
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsAddAttributeModalOpen(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAddAttribute}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Creating...
                  </>
                ) : (
                  'Create'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Attribute Modal */}
      {isEditAttributeModalOpen && currentAttribute && currentEntity && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Edit Attribute</h2>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Name</span>
              </label>
              <input
                type="text"
                name="name"
                className="input input-bordered"
                value={currentAttribute.name}
                onChange={handleAttributeChange}
                required
              />
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Description</span>
              </label>
              <textarea
                name="description"
                className="textarea textarea-bordered"
                value={currentAttribute.description}
                onChange={handleAttributeChange}
              ></textarea>
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Type</span>
              </label>
              <select
                name="type"
                className="select select-bordered"
                value={currentAttribute.type}
                onChange={handleAttributeChange}
              >
                {Object.values(AttributeType).map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Required</span>
              </label>
              <select
                name="required"
                className="select select-bordered"
                value={currentAttribute.required ? 'true' : 'false'}
                onChange={handleAttributeChange}
              >
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsEditAttributeModalOpen(false);
                  setCurrentAttribute(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleEditAttribute}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Updating...
                  </>
                ) : (
                  'Update'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Attribute Modal */}
      {isDeleteAttributeModalOpen && currentAttribute && currentEntity && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Delete Attribute</h2>

            <p className="mb-4">
              Are you sure you want to delete the attribute <strong>{currentAttribute.name}</strong> from entity <strong>{currentEntity.name}</strong>? This action cannot be undone.
            </p>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsDeleteAttributeModalOpen(false);
                  setCurrentAttribute(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-error"
                onClick={handleDeleteAttribute}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Relationship Modal */}
      {isAddRelationshipModalOpen && currentPackage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-lg">
            <h2 className="text-xl font-bold mb-4">Add Relationship to {currentPackage.name}</h2>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Description</span>
              </label>
              <textarea
                name="description"
                className="textarea textarea-bordered"
                value={newRelationship.description}
                onChange={handleRelationshipChange}
              ></textarea>
            </div>

            <div className="divider">Source</div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Source Entity</span>
              </label>
              <select
                name="sourceEntity"
                className="select select-bordered"
                value={newRelationship.source?.entity || ''}
                onChange={handleRelationshipChange}
                disabled={loadingEntities}
              >
                <option value="">Select source entity</option>
                {availableEntities.map(entity => (
                  <option key={entity} value={entity}>{entity}</option>
                ))}
              </select>
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Source Cardinality</span>
              </label>
              <select
                name="sourceCardinality"
                className="select select-bordered"
                value={newRelationship.source?.cardinality || Cardinality.ONE}
                onChange={handleRelationshipChange}
              >
                {Object.values(Cardinality).map(card => (
                  <option key={card} value={card}>{card}</option>
                ))}
              </select>
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Source Navigation Name (optional)</span>
              </label>
              <input
                type="text"
                name="sourceName"
                className="input input-bordered"
                value={newRelationship.source?.name || ''}
                onChange={handleRelationshipChange}
              />
            </div>

            <div className="divider">Target</div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Target Entity</span>
              </label>
              <select
                name="targetEntity"
                className="select select-bordered"
                value={newRelationship.target?.entity || ''}
                onChange={handleRelationshipChange}
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
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Target Cardinality</span>
              </label>
              <select
                name="targetCardinality"
                className="select select-bordered"
                value={newRelationship.target?.cardinality || Cardinality.ONE}
                onChange={handleRelationshipChange}
              >
                {Object.values(Cardinality).map(card => (
                  <option key={card} value={card}>{card}</option>
                ))}
              </select>
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Target Navigation Name (optional)</span>
              </label>
              <input
                type="text"
                name="targetName"
                className="input input-bordered"
                value={newRelationship.target?.name || ''}
                onChange={handleRelationshipChange}
              />
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsAddRelationshipModalOpen(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAddRelationship}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Creating...
                  </>
                ) : (
                  'Create'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Relationship Modal */}
      {isEditRelationshipModalOpen && currentRelationship && currentPackage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-lg">
            <h2 className="text-xl font-bold mb-4">Edit Relationship</h2>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Description</span>
              </label>
              <textarea
                name="description"
                className="textarea textarea-bordered"
                value={currentRelationship.description}
                onChange={handleRelationshipChange}
              ></textarea>
            </div>

            <div className="divider">Source</div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Source Entity</span>
              </label>
              <select
                name="sourceEntity"
                className="select select-bordered"
                value={currentRelationship.source.entity}
                onChange={handleRelationshipChange}
                disabled={loadingEntities}
              >
                <option value="">Select source entity</option>
                {availableEntities.map(entity => (
                  <option key={entity} value={entity}>{entity}</option>
                ))}
              </select>
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Source Cardinality</span>
              </label>
              <select
                name="sourceCardinality"
                className="select select-bordered"
                value={currentRelationship.source.cardinality}
                onChange={handleRelationshipChange}
              >
                {Object.values(Cardinality).map(card => (
                  <option key={card} value={card}>{card}</option>
                ))}
              </select>
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Source Navigation Name (optional)</span>
              </label>
              <input
                type="text"
                name="sourceName"
                className="input input-bordered"
                value={currentRelationship.source.name || ''}
                onChange={handleRelationshipChange}
              />
            </div>

            <div className="divider">Target</div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Target Entity</span>
              </label>
              <select
                name="targetEntity"
                className="select select-bordered"
                value={currentRelationship.target.entity}
                onChange={handleRelationshipChange}
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
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Target Cardinality</span>
              </label>
              <select
                name="targetCardinality"
                className="select select-bordered"
                value={currentRelationship.target.cardinality}
                onChange={handleRelationshipChange}
              >
                {Object.values(Cardinality).map(card => (
                  <option key={card} value={card}>{card}</option>
                ))}
              </select>
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Target Navigation Name (optional)</span>
              </label>
              <input
                type="text"
                name="targetName"
                className="input input-bordered"
                value={currentRelationship.target.name || ''}
                onChange={handleRelationshipChange}
              />
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsEditRelationshipModalOpen(false);
                  setCurrentRelationship(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleEditRelationship}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Updating...
                  </>
                ) : (
                  'Update'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Relationship Modal */}
      {isDeleteRelationshipModalOpen && currentRelationship && currentPackage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Delete Relationship</h2>

            <p className="mb-4">
              Are you sure you want to delete the relationship between <strong>{findEntityNameByUuid(currentRelationship.source.entity)}</strong> and <strong>{findEntityNameByUuid(currentRelationship.target.entity)}</strong> from package <strong>{currentPackage.name}</strong>? This action cannot be undone.
            </p>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsDeleteRelationshipModalOpen(false);
                  setCurrentRelationship(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-error"
                onClick={handleDeleteRelationship}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EntityTreeTable;
