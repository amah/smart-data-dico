import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

// Use the same base directory as in fileOperations.ts
const DATA_DICTIONARIES_BASE = path.join(process.cwd(), '..', 'data-dictionaries');

export interface DiagramLayout {
  id: string;
  name: string;
  service?: string;
  entities: {
    [entityUuid: string]: {
      x: number;
      y: number;
      showProperties: boolean;
      name?: string; // Include name for readability
    };
  };
  zoom: number;
  pan: {
    x: number;
    y: number;
  };
  createdAt: string;
  updatedAt: string;
}

const DIAGRAMS_DIR = path.join(DATA_DICTIONARIES_BASE, 'diagrams');

export class DiagramService {
  private async ensureDiagramsDirectory(): Promise<void> {
    try {
      await fs.access(DIAGRAMS_DIR);
    } catch {
      await fs.mkdir(DIAGRAMS_DIR, { recursive: true });
    }
  }

  async saveDiagramLayout(layout: Omit<DiagramLayout, 'createdAt' | 'updatedAt'>): Promise<DiagramLayout> {
    try {
      await this.ensureDiagramsDirectory();
      
      const now = new Date().toISOString();
      const diagramLayout: DiagramLayout = {
        ...layout,
        createdAt: now,
        updatedAt: now
      };

      const filename = `${layout.id}.json`;
      const filepath = path.join(DIAGRAMS_DIR, filename);
      
      await fs.writeFile(filepath, JSON.stringify(diagramLayout, null, 2));
      
      logger.info(`Saved diagram layout: ${layout.id}`);
      return diagramLayout;
    } catch (error) {
      logger.error('Error saving diagram layout:', error);
      throw new Error('Failed to save diagram layout');
    }
  }

  async loadDiagramLayout(id: string): Promise<DiagramLayout | null> {
    try {
      const filename = `${id}.json`;
      const filepath = path.join(DIAGRAMS_DIR, filename);
      
      const data = await fs.readFile(filepath, 'utf-8');
      const layout = JSON.parse(data) as DiagramLayout;
      
      logger.info(`Loaded diagram layout: ${id}`);
      return layout;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        logger.warn(`Diagram layout not found: ${id}`);
        return null;
      }
      logger.error('Error loading diagram layout:', error);
      throw new Error('Failed to load diagram layout');
    }
  }

  async updateDiagramLayout(id: string, updates: Partial<Omit<DiagramLayout, 'id' | 'createdAt' | 'updatedAt'>>): Promise<DiagramLayout> {
    try {
      const existingLayout = await this.loadDiagramLayout(id);
      if (!existingLayout) {
        throw new Error('Diagram layout not found');
      }

      const updatedLayout: DiagramLayout = {
        ...existingLayout,
        ...updates,
        id, // Ensure ID doesn't change
        updatedAt: new Date().toISOString()
      };

      const filename = `${id}.json`;
      const filepath = path.join(DIAGRAMS_DIR, filename);
      
      await fs.writeFile(filepath, JSON.stringify(updatedLayout, null, 2));
      
      logger.info(`Updated diagram layout: ${id}`);
      return updatedLayout;
    } catch (error) {
      logger.error('Error updating diagram layout:', error);
      throw new Error('Failed to update diagram layout');
    }
  }

  async deleteDiagramLayout(id: string): Promise<void> {
    try {
      const filename = `${id}.json`;
      const filepath = path.join(DIAGRAMS_DIR, filename);
      
      await fs.unlink(filepath);
      
      logger.info(`Deleted diagram layout: ${id}`);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        logger.warn(`Diagram layout not found for deletion: ${id}`);
        return;
      }
      logger.error('Error deleting diagram layout:', error);
      throw new Error('Failed to delete diagram layout');
    }
  }

  async listDiagramLayouts(service?: string): Promise<DiagramLayout[]> {
    try {
      await this.ensureDiagramsDirectory();
      
      const files = await fs.readdir(DIAGRAMS_DIR);
      const jsonFiles = files.filter(file => file.endsWith('.json'));
      
      const layouts: DiagramLayout[] = [];
      
      for (const file of jsonFiles) {
        try {
          const filepath = path.join(DIAGRAMS_DIR, file);
          const data = await fs.readFile(filepath, 'utf-8');
          const layout = JSON.parse(data) as DiagramLayout;
          
          // Filter by service if specified
          if (!service || layout.service === service) {
            layouts.push(layout);
          }
        } catch (error) {
          logger.warn(`Error reading diagram layout file ${file}:`, error);
        }
      }
      
      // Sort by updatedAt descending
      layouts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      
      logger.info(`Listed ${layouts.length} diagram layouts${service ? ` for service ${service}` : ''}`);
      return layouts;
    } catch (error) {
      logger.error('Error listing diagram layouts:', error);
      throw new Error('Failed to list diagram layouts');
    }
  }
}

export const diagramService = new DiagramService();