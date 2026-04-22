import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import EntityDetail from './EntityDetail';
import AttributeEditor from './AttributeEditor';
import RelationshipEditor from './RelationshipEditor';
import PackageDetailPage from '../pages/PackageDetailPage';
import AttributeDetailPage from '../pages/AttributeDetailPage';
import { servicesApi, relationshipApi } from '../services/api';
import { Attribute, Relationship } from '../types';

export default function PackageRouter() {
  const params = useParams();
  const wildcard = params['*'] || '';
  const segments = wildcard.split('/').filter(Boolean);

  const entitiesIndex = segments.indexOf('entities');

  if (entitiesIndex >= 0 && entitiesIndex < segments.length - 1) {
    // Entity mode: /packages/root/sub/.../entities/EntityName[/...]
    const packagePath = segments.slice(0, entitiesIndex);
    const entityName = segments[entitiesIndex + 1];
    const service = packagePath[0]; // Root package = service for backend API
    const rest = segments.slice(entitiesIndex + 2);

    // Relationship routes: /relationships/create or /relationships/:uuid/edit
    if (rest[0] === 'relationships') {
      if (rest[1] === 'create') {
        return (
          <RelationshipEditor
            key={`${service}-${entityName}-rel-create`}
            serviceProp={service}
            entityProp={entityName}
          />
        );
      }
      if (rest.length >= 2 && rest[2] === 'edit') {
        return (
          <RelationshipEditLoader
            service={service}
            entityName={entityName}
            relationshipUuid={rest[1]}
          />
        );
      }
    }

    // Attribute routes:
    //   /attributes/create        → AttributeEditor (new-form mode)
    //   /attributes/:name/edit    → AttributeEditor (edit-form mode)
    //   /attributes/:name         → AttributeDetailPage (single-column view,
    //                               per-section inline editing) — Phase 5.1
    if (rest[0] === 'attributes') {
      if (rest[1] === 'create') {
        return (
          <AttributeEditor
            key={`${service}-${entityName}-create`}
            serviceProp={service}
            entityProp={entityName}
          />
        );
      }
      if (rest.length >= 2 && rest[2] === 'edit') {
        return (
          <AttributeEditLoader
            service={service}
            entityName={entityName}
            attributeName={rest[1]}
            isEdit
          />
        );
      }
      if (rest.length >= 2) {
        return <AttributeDetailPage key={`${service}-${entityName}-${rest[1]}`} />;
      }
    }

    const isEdit = rest[0] === 'edit';

    return (
      <EntityDetail
        key={`${service}-${entityName}`}
        serviceProp={service}
        entityProp={entityName}
        packagePath={packagePath}
        editMode={isEdit}
      />
    );
  }

  // Package mode: /packages/root/sub1/sub2
  return <PackageDetailPage packagePath={segments} />;
}

/**
 * Loads entity data and finds the attribute for editing.
 */
function AttributeEditLoader({
  service,
  entityName,
  attributeName,
  isEdit,
}: {
  service: string;
  entityName: string;
  attributeName: string;
  isEdit: boolean;
}) {
  const [attribute, setAttribute] = useState<Attribute | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    servicesApi
      .getEntitySchema(service, entityName)
      .then((res) => {
        const attr = res.data.attributes?.find(
          (a: Attribute) => a.name === attributeName
        );
        setAttribute(attr || null);
      })
      .catch(() => setAttribute(null))
      .finally(() => setLoading(false));
  }, [service, entityName, attributeName]);

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <AttributeEditor
      key={`${service}-${entityName}-${attributeName}`}
      isEdit={isEdit}
      initialData={attribute || undefined}
      serviceProp={service}
      entityProp={entityName}
    />
  );
}

/**
 * Loads a relationship by UUID from the package's relationships.yaml,
 * then renders the editor in edit mode with the existing data.
 */
function RelationshipEditLoader({
  service,
  entityName,
  relationshipUuid,
}: {
  service: string;
  entityName: string;
  relationshipUuid: string;
}) {
  const [rel, setRel] = useState<Relationship | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    relationshipApi
      .getPackageRelationships(service)
      .then((rels: Relationship[]) => {
        setRel(rels.find(r => r.uuid === relationshipUuid) || null);
      })
      .catch(() => setRel(null))
      .finally(() => setLoading(false));
  }, [service, relationshipUuid]);

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <RelationshipEditor
      key={`${service}-${entityName}-${relationshipUuid}`}
      isEdit
      initialData={rel || undefined}
      serviceProp={service}
      entityProp={entityName}
    />
  );
}
