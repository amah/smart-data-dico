import { listMicroservices, listMicroserviceEntities, readEntityFile, readRelationshipsFile, getPackagePath } from '../utils/fileOperations.js';
import { stereotypeService } from './stereotypeService.js';
import { logger } from '../utils/logger.js';

interface EntityQuality {
  name: string;
  uuid: string;
  descriptionFilled: boolean;
  attributeDescriptionRate: number;
  stereotypeCompliant: boolean;
  hasRelationships: boolean;
  score: number;
}

interface PackageQuality {
  name: string;
  entityCount: number;
  descriptionCoverage: number;
  metadataCoverage: number;
  relationshipCoverage: number;
  overallScore: number;
  entities: EntityQuality[];
}

interface QualityReport {
  overall: number;
  totalEntities: number;
  totalAttributes: number;
  packages: PackageQuality[];
}

class QualityService {
  async getQualityReport(service?: string): Promise<QualityReport> {
    const services = service ? [service] : await listMicroservices();
    const packages: PackageQuality[] = [];

    for (const svc of services) {
      const entityNames = await listMicroserviceEntities(svc);
      const entities: EntityQuality[] = [];

      let relEntityUuids = new Set<string>();
      try {
        const rels = await readRelationshipsFile(getPackagePath(svc));
        for (const rel of rels) {
          relEntityUuids.add(rel.source.entity);
          relEntityUuids.add(rel.target.entity);
        }
      } catch { /* ok */ }

      for (const name of entityNames) {
        const entity = await readEntityFile(svc, name);
        if (!entity) continue;

        const descFilled = !!entity.description;
        const totalAttrs = entity.attributes.length;
        const attrsWithDesc = entity.attributes.filter(a => a.description && a.description.trim()).length;
        const attrDescRate = totalAttrs > 0 ? (attrsWithDesc / totalAttrs) * 100 : 100;
        const hasRels = relEntityUuids.has(entity.uuid);

        // Check stereotype compliance
        let stereotypeCompliant = true;
        if (entity.stereotype) {
          const stereotype = await stereotypeService.getStereotype(entity.stereotype);
          if (stereotype) {
            const errors = stereotypeService.validateMetadata(stereotype, entity.metadata);
            stereotypeCompliant = errors.length === 0;
          }
        }

        // Score: description 30%, attribute descriptions 30%, relationships 20%, stereotype 20%
        const score = (
          (descFilled ? 30 : 0) +
          (attrDescRate * 0.3) +
          (hasRels ? 20 : 0) +
          (stereotypeCompliant ? 20 : 0)
        );

        entities.push({
          name: entity.name,
          uuid: entity.uuid,
          descriptionFilled: descFilled,
          attributeDescriptionRate: Math.round(attrDescRate),
          stereotypeCompliant,
          hasRelationships: hasRels,
          score: Math.round(score),
        });
      }

      const entityCount = entities.length;
      const descCoverage = entityCount > 0
        ? Math.round((entities.filter(e => e.descriptionFilled).length / entityCount) * 100) : 100;
      const metaCoverage = entityCount > 0
        ? Math.round((entities.filter(e => e.stereotypeCompliant).length / entityCount) * 100) : 100;
      const relCoverage = entityCount > 0
        ? Math.round((entities.filter(e => e.hasRelationships).length / entityCount) * 100) : 100;
      const overallScore = entityCount > 0
        ? Math.round(entities.reduce((sum, e) => sum + e.score, 0) / entityCount) : 100;

      packages.push({
        name: svc,
        entityCount,
        descriptionCoverage: descCoverage,
        metadataCoverage: metaCoverage,
        relationshipCoverage: relCoverage,
        overallScore,
        entities,
      });
    }

    const totalEntities = packages.reduce((sum, p) => sum + p.entityCount, 0);
    const totalAttributes = packages.reduce((sum, p) =>
      sum + p.entities.reduce((s, e) => s + (e.attributeDescriptionRate > 0 ? 1 : 0), 0), 0);
    const overall = packages.length > 0
      ? Math.round(packages.reduce((sum, p) => sum + p.overallScore, 0) / packages.length) : 100;

    return { overall, totalEntities, totalAttributes, packages };
  }
}

export const qualityService = new QualityService();
