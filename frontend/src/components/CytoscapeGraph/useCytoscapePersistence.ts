import { useState, useCallback } from 'react';
import type { Core } from 'cytoscape';
import type { DiagramLayout } from '../../types';
import { diagramApi } from '../../services/api';

interface PersistenceResult {
  layouts: DiagramLayout[];
  loading: boolean;
  loadLayouts: (service?: string) => void;
  saveLayout: (name: string, service?: string) => void;
  loadLayout: (id: string) => void;
  deleteLayout: (id: string) => void;
  applyLayout: (layout: DiagramLayout) => void;
}

export function useCytoscapePersistence(cyRef: React.RefObject<Core | null>): PersistenceResult {
  const [layouts, setLayouts] = useState<DiagramLayout[]>([]);
  const [loading, setLoading] = useState(false);

  const loadLayouts = useCallback(async (service?: string) => {
    try {
      setLoading(true);
      const response = await diagramApi.listDiagramLayouts(service);
      const data = response.data ?? response;
      setLayouts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Could not load diagram layouts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const applyLayout = useCallback(
    (layout: DiagramLayout) => {
      const cy = cyRef.current;
      if (!cy) return;

      cy.batch(() => {
        Object.entries(layout.entities).forEach(([uuid, pos]) => {
          const node = cy.getElementById(uuid);
          if (node.length) {
            node.position({ x: pos.x, y: pos.y });
            node.data('expanded', pos.showProperties);
          }
        });
      });

      cy.zoom(layout.zoom);
      cy.pan(layout.pan);
    },
    [cyRef],
  );

  const saveLayout = useCallback(
    async (name: string, service?: string) => {
      const cy = cyRef.current;
      const entities: DiagramLayout['entities'] = {};

      if (cy) {
        cy.nodes()
          .not(':parent')
          .forEach((node) => {
            entities[node.id()] = {
              x: node.position('x'),
              y: node.position('y'),
              showProperties: node.data('expanded') ?? false,
              name: node.data('label'),
            };
          });
      }

      const layout = {
        id: `${service || 'all'}-${Date.now()}`,
        name,
        service,
        entities,
        zoom: cy?.zoom() ?? 1,
        pan: cy?.pan() ?? { x: 0, y: 0 },
      };

      try {
        const saved = await diagramApi.saveDiagramLayout(layout);
        setLayouts((prev) => [...prev, saved.data ?? saved]);
      } catch (err) {
        console.error('Failed to save layout:', err);
      }
    },
    [cyRef],
  );

  const loadLayout = useCallback(
    async (id: string) => {
      try {
        const response = await diagramApi.loadDiagramLayout(id);
        const layout = response.data ?? response;
        applyLayout(layout);
      } catch (err) {
        console.error('Failed to load layout:', err);
      }
    },
    [applyLayout],
  );

  const deleteLayout = useCallback(async (id: string) => {
    try {
      await diagramApi.deleteDiagramLayout(id);
      setLayouts((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      console.error('Failed to delete layout:', err);
    }
  }, []);

  return { layouts, loading, loadLayouts, saveLayout, loadLayout, deleteLayout, applyLayout };
}
