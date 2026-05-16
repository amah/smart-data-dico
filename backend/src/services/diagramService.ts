import { logger } from '../utils/logger.js';
import { storageRegistry } from '../storage/contract/StorageBackendToken.js';
import type { IStorageBackend } from '../storage/contract/IStorageBackend.js';
import { wsId, pathOf, type WorkspaceId, type Path } from '../storage/contract/types.js';

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

export class DiagramService {
  private _storage?: IStorageBackend;
  private get storage(): IStorageBackend {
    if (!this._storage) this._storage = storageRegistry.getBackend();
    return this._storage;
  }

  constructor(
    storage?: IStorageBackend,
    private readonly ws: WorkspaceId = wsId('dictionaries'),
    private readonly diagramsDir: Path = pathOf('.dico/diagrams'),
  ) {
    this._storage = storage;
  }

  private async ensureDiagramsDirectory(): Promise<void> {
    await this.storage.mkdir(this.ws, this.diagramsDir, true);
  }

  async saveDiagramLayout(layout: Omit<DiagramLayout, 'createdAt' | 'updatedAt'>): Promise<DiagramLayout> {
    try {
      await this.ensureDiagramsDirectory();

      const now = new Date().toISOString();
      const diagramLayout: DiagramLayout = {
        ...layout,
        createdAt: now,
        updatedAt: now,
      };

      await this.storage.write(
        this.ws,
        pathOf(`${this.diagramsDir}/${layout.id}.json`),
        JSON.stringify(diagramLayout, null, 2),
        { createParents: true },
      );

      logger.info(`Saved diagram layout: ${layout.id}`);
      return diagramLayout;
    } catch (error) {
      logger.error('Error saving diagram layout:', error);
      throw new Error('Failed to save diagram layout');
    }
  }

  async loadDiagramLayout(id: string): Promise<DiagramLayout | null> {
    try {
      const data = await this.storage.read(
        this.ws,
        pathOf(`${this.diagramsDir}/${id}.json`),
      );
      const layout = JSON.parse(data) as DiagramLayout;

      logger.info(`Loaded diagram layout: ${id}`);
      return layout;
    } catch (e) {
      if ((e as { code?: string }).code === 'not-found') {
        logger.warn(`Diagram layout not found: ${id}`);
        return null;
      }
      logger.error('Error loading diagram layout:', e);
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
        updatedAt: new Date().toISOString(),
      };

      await this.storage.write(
        this.ws,
        pathOf(`${this.diagramsDir}/${id}.json`),
        JSON.stringify(updatedLayout, null, 2),
      );

      logger.info(`Updated diagram layout: ${id}`);
      return updatedLayout;
    } catch (error) {
      logger.error('Error updating diagram layout:', error);
      throw new Error('Failed to update diagram layout');
    }
  }

  async deleteDiagramLayout(id: string): Promise<void> {
    try {
      await this.storage.delete(
        this.ws,
        pathOf(`${this.diagramsDir}/${id}.json`),
      );

      logger.info(`Deleted diagram layout: ${id}`);
    } catch (e) {
      if ((e as { code?: string }).code === 'not-found') {
        logger.warn(`Diagram layout not found for deletion: ${id}`);
        return;
      }
      logger.error('Error deleting diagram layout:', e);
      throw new Error('Failed to delete diagram layout');
    }
  }

  async listDiagramLayouts(service?: string): Promise<DiagramLayout[]> {
    try {
      await this.ensureDiagramsDirectory();

      const entries = await this.storage.list(this.ws, this.diagramsDir);
      const jsonEntries = entries.filter(entry => entry.name.endsWith('.json') && !entry.isDirectory);

      const layouts: DiagramLayout[] = [];

      for (const entry of jsonEntries) {
        try {
          // Use workspace-relative path, not entry.path (which is absolute)
          const data = await this.storage.read(
            this.ws,
            pathOf(`${this.diagramsDir}/${entry.name}`),
          );
          const layout = JSON.parse(data) as DiagramLayout;

          // Filter by service if specified
          if (!service || layout.service === service) {
            layouts.push(layout);
          }
        } catch (error) {
          logger.warn(`Error reading diagram layout file ${entry.name}:`, error);
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
