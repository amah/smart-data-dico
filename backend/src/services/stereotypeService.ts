import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { Stereotype, StereotypeTarget, MetadataEntry } from '../models/EntitySchema.js';
import { logger } from '../utils/logger.js';
import { config } from '../kernel/config.js';
import type { MetadataValidationError } from './metadata/MetadataTypeRegistry.js';
import { metadataTypeRegistry } from './metadata/index.js';

const getStereotypesFile = () => path.join(config.dataDir, '.dico', 'stereotypes.yaml');

class StereotypeService {
  private readStereotypes(): Stereotype[] {
    if (!fs.existsSync(getStereotypesFile())) return [];
    const content = fs.readFileSync(getStereotypesFile(), 'utf8');
    return YAML.parse(content) || [];
  }

  private writeStereotypes(stereotypes: Stereotype[]): void {
    fs.writeFileSync(getStereotypesFile(), YAML.stringify(stereotypes), 'utf8');
  }

  async getAllStereotypes(appliesTo?: StereotypeTarget): Promise<Stereotype[]> {
    const all = this.readStereotypes();
    if (appliesTo) return all.filter((s) => s.appliesTo === appliesTo);
    return all;
  }

  async getStereotype(id: string): Promise<Stereotype | null> {
    const all = this.readStereotypes();
    return all.find((s) => s.id === id) || null;
  }

  async createStereotype(data: Stereotype): Promise<{ success: boolean; stereotype?: Stereotype; errors?: string[] }> {
    if (!data.id || !data.name || !data.appliesTo) {
      return { success: false, errors: ['id, name, and appliesTo are required'] };
    }
    if (!['package', 'entity', 'attribute', 'model', 'relationship'].includes(data.appliesTo)) {
      return { success: false, errors: ['appliesTo must be one of: package, entity, attribute, model, relationship'] };
    }

    const all = this.readStereotypes();
    if (all.find((s) => s.id === data.id)) {
      return { success: false, errors: [`Stereotype with id '${data.id}' already exists`] };
    }

    const stereotype: Stereotype = {
      id: data.id,
      name: data.name,
      description: data.description,
      domain: data.domain,
      appliesTo: data.appliesTo,
      metadataDefinitions: data.metadataDefinitions || [],
    };

    all.push(stereotype);
    this.writeStereotypes(all);
    return { success: true, stereotype };
  }

  async updateStereotype(id: string, data: Partial<Stereotype>): Promise<{ success: boolean; stereotype?: Stereotype; errors?: string[] }> {
    const all = this.readStereotypes();
    const index = all.findIndex((s) => s.id === id);
    if (index === -1) return { success: false, errors: ['Stereotype not found'] };

    all[index] = {
      ...all[index],
      name: data.name ?? all[index].name,
      description: data.description ?? all[index].description,
      domain: data.domain ?? all[index].domain,
      appliesTo: data.appliesTo ?? all[index].appliesTo,
      metadataDefinitions: data.metadataDefinitions ?? all[index].metadataDefinitions,
    };

    this.writeStereotypes(all);
    return { success: true, stereotype: all[index] };
  }

  async deleteStereotype(id: string): Promise<{ success: boolean; errors?: string[] }> {
    const all = this.readStereotypes();
    const filtered = all.filter((s) => s.id !== id);
    if (filtered.length === all.length) return { success: false, errors: ['Stereotype not found'] };
    this.writeStereotypes(filtered);
    return { success: true };
  }

  /**
   * Validate metadata against a stereotype using the registry.
   * Returns path-aware errors with full nesting support.
   */
  validateMetadata(stereotype: Stereotype, metadata: MetadataEntry[] = []): MetadataValidationError[] {
    return metadataTypeRegistry.validateBlock(metadata, stereotype.metadataDefinitions, stereotype.name);
  }

  /**
   * @deprecated Use `validateMetadata` which now returns `MetadataValidationError[]`.
   * Shim preserved for callers that expect `string[]` during the migration window.
   */
  validateMetadataLegacy(stereotype: Stereotype, metadata: MetadataEntry[] = []): string[] {
    return this.validateMetadata(stereotype, metadata).map(
      (e) => `Required metadata '${e.path}' is missing (stereotype: ${stereotype.name})`,
    );
  }
}

export const stereotypeService = new StereotypeService();
