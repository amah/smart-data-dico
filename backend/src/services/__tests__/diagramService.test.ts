/**
 * diagramService.test.ts — slice-2 migration tests
 *
 * Covers: save/load/update/delete/list + not-found branches.
 * Uses InMemoryStorageBackend — no disk I/O.
 */
import { DiagramService, type DiagramLayout } from '../diagramService.js';
import { InMemoryStorageBackend } from '../../storage/memory/InMemoryStorageBackend.js';
import { wsId, pathOf } from '../../storage/contract/types.js';

jest.mock('../../utils/logger');

const WS = wsId('dictionaries');

function makeService(backend: InMemoryStorageBackend): DiagramService {
  return new DiagramService(backend, WS, pathOf('.dico/diagrams'));
}

const baseLayout: Omit<DiagramLayout, 'createdAt' | 'updatedAt'> = {
  id: 'diag-1',
  name: 'Test Diagram',
  service: 'order-service',
  entities: {
    'entity-uuid-1': { x: 100, y: 200, showProperties: true, name: 'Order' },
  },
  zoom: 1.0,
  pan: { x: 0, y: 0 },
};

describe('diagramService', () => {
  let backend: InMemoryStorageBackend;
  let svc: DiagramService;

  beforeEach(() => {
    backend = new InMemoryStorageBackend();
    svc = makeService(backend);
  });

  describe('saveDiagramLayout', () => {
    it('saves a diagram layout and returns it with timestamps', async () => {
      const result = await svc.saveDiagramLayout(baseLayout);

      expect(result.id).toBe('diag-1');
      expect(result.name).toBe('Test Diagram');
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(result.entities['entity-uuid-1'].name).toBe('Order');
    });

    it('persists the data so it can be read back', async () => {
      await svc.saveDiagramLayout(baseLayout);

      const raw = await backend.read(WS, pathOf('.dico/diagrams/diag-1.json'));
      const parsed = JSON.parse(raw);
      expect(parsed.id).toBe('diag-1');
    });
  });

  describe('loadDiagramLayout', () => {
    it('returns null for a diagram that does not exist', async () => {
      const result = await svc.loadDiagramLayout('nonexistent');
      expect(result).toBeNull();
    });

    it('returns the saved diagram', async () => {
      await svc.saveDiagramLayout(baseLayout);

      const loaded = await svc.loadDiagramLayout('diag-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('diag-1');
      expect(loaded!.name).toBe('Test Diagram');
    });
  });

  describe('updateDiagramLayout', () => {
    it('updates fields and refreshes updatedAt', async () => {
      const saved = await svc.saveDiagramLayout(baseLayout);
      const before = new Date(saved.updatedAt).getTime();

      // Small delay to ensure updatedAt changes
      await new Promise(r => setTimeout(r, 2));

      const updated = await svc.updateDiagramLayout('diag-1', { name: 'Updated Name', zoom: 1.5 });
      expect(updated.name).toBe('Updated Name');
      expect(updated.zoom).toBe(1.5);
      expect(updated.id).toBe('diag-1'); // id must not change
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(before);
    });

    it('throws when the diagram does not exist', async () => {
      await expect(svc.updateDiagramLayout('ghost', { zoom: 2 })).rejects.toThrow('Failed to update diagram layout');
    });
  });

  describe('deleteDiagramLayout', () => {
    it('deletes an existing diagram', async () => {
      await svc.saveDiagramLayout(baseLayout);
      await svc.deleteDiagramLayout('diag-1');

      const result = await svc.loadDiagramLayout('diag-1');
      expect(result).toBeNull();
    });

    it('does not throw when deleting a non-existent diagram (not-found is silent)', async () => {
      await expect(svc.deleteDiagramLayout('ghost')).resolves.not.toThrow();
    });
  });

  describe('listDiagramLayouts', () => {
    it('returns empty array when no diagrams exist', async () => {
      const layouts = await svc.listDiagramLayouts();
      expect(layouts).toEqual([]);
    });

    it('returns all saved diagrams sorted by updatedAt descending', async () => {
      await svc.saveDiagramLayout({ ...baseLayout, id: 'diag-1', service: 'order-service' });
      await new Promise(r => setTimeout(r, 2));
      await svc.saveDiagramLayout({ ...baseLayout, id: 'diag-2', service: 'user-service' });

      const layouts = await svc.listDiagramLayouts();
      expect(layouts).toHaveLength(2);
      // diag-2 was created later so its updatedAt should come first
      expect(layouts[0].id).toBe('diag-2');
      expect(layouts[1].id).toBe('diag-1');
    });

    it('filters by service when specified', async () => {
      await svc.saveDiagramLayout({ ...baseLayout, id: 'diag-1', service: 'order-service' });
      await svc.saveDiagramLayout({ ...baseLayout, id: 'diag-2', service: 'user-service' });

      const orderLayouts = await svc.listDiagramLayouts('order-service');
      expect(orderLayouts).toHaveLength(1);
      expect(orderLayouts[0].id).toBe('diag-1');
    });
  });
});
