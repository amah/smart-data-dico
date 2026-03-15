/**
 * YamlFileInfoEnricher
 *
 * FileInfoEnricher that parses .yaml files and adds entity metadata
 * (entity name, uuid, microservice) to the file info response.
 */

import YAML from 'yaml';
import { logger } from '../utils/logger.js';

export interface YamlEnrichedData {
  entityName?: string;
  entityUuid?: string;
  microservice?: string;
  entityVersion?: string;
}

/**
 * Creates a YAML file info enricher compatible with
 * @hamak/filesystem-server-impl's FileInfoEnricherRegistry.
 */
export function createYamlFileInfoEnricher() {
  return {
    name: 'yaml-entity',
    extensionKey: 'entity',

    canEnrich(fileInfo: any): boolean {
      const name: string = fileInfo?.name || '';
      return name.endsWith('.yaml') || name.endsWith('.yml');
    },

    async enrich(fileInfo: any, context: any): Promise<YamlEnrichedData | null> {
      try {
        // Read the file content to extract entity metadata
        const content = context?.content;
        if (!content) {
          return null;
        }

        const parsed = YAML.parse(content);
        if (!parsed || typeof parsed !== 'object') {
          return null;
        }

        return {
          entityName: parsed.name,
          entityUuid: parsed.uuid,
          microservice: parsed.microservice,
          entityVersion: parsed.version,
        };
      } catch (error) {
        logger.debug(`YamlFileInfoEnricher: could not parse ${fileInfo?.name}: ${error}`);
        return null;
      }
    },
  };
}
