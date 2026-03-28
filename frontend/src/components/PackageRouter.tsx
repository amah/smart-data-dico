import { useParams } from 'react-router-dom';
import EntityDetail from './EntityDetail';
import PackageDetailPage from '../pages/PackageDetailPage';

export default function PackageRouter() {
  const params = useParams();
  const wildcard = params['*'] || '';
  const segments = wildcard.split('/').filter(Boolean);

  const entitiesIndex = segments.indexOf('entities');

  if (entitiesIndex >= 0 && entitiesIndex < segments.length - 1) {
    // Entity mode: /packages/root/sub/.../entities/EntityName
    const packagePath = segments.slice(0, entitiesIndex);
    const entityName = segments[entitiesIndex + 1];
    const service = packagePath[0]; // Root package = service for backend API
    const isEdit = segments[entitiesIndex + 2] === 'edit';

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
