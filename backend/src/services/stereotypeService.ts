import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { Stereotype, StereotypeTarget, MetadataEntry } from '../models/EntitySchema.js';
import { logger } from '../utils/logger.js';
import { config } from '../kernel/config.js';

const getStereotypesFile = () => path.join(config.dataDir, 'stereotypes.yaml');

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
    if (!['package', 'entity', 'attribute'].includes(data.appliesTo)) {
      return { success: false, errors: ['appliesTo must be package, entity, or attribute'] };
    }

    const all = this.readStereotypes();
    if (all.find((s) => s.id === data.id)) {
      return { success: false, errors: [`Stereotype with id '${data.id}' already exists`] };
    }

    const stereotype: Stereotype = {
      id: data.id,
      name: data.name,
      description: data.description,
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

  validateMetadata(stereotype: Stereotype, metadata: MetadataEntry[] = []): string[] {
    const errors: string[] = [];
    for (const def of stereotype.metadataDefinitions) {
      if (def.required) {
        const entry = metadata.find((m) => m.name === def.name);
        if (!entry || entry.value === undefined || entry.value === '') {
          errors.push(`Required metadata '${def.name}' is missing (stereotype: ${stereotype.name})`);
        }
      }
    }
    return errors;
  }
}

export const stereotypeService = new StereotypeService();
