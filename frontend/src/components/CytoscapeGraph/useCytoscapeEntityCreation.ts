import { useCallback, useEffect, useRef, useState } from 'react';
import type { Core } from 'cytoscape';
import { servicesApi } from '../../services/api';
import type { Entity } from '../../types';

export interface PendingCreate {
  /** Package options offered in the modal. */
  packageOptions: string[];
  /** Pre-selected package. */
  defaultPackage: string;
  /** Canvas position (Cytoscape model coords) to drop the new node. */
  position: { x: number; y: number } | null;
}

interface EntityCreationState {
  pending: PendingCreate | null;
  /**
   * Opens the modal. If `position` is omitted, the node is placed at the
   * current viewport center.
   */
  startCreate: (defaultPackage: string, position?: { x: number; y: number }) => void;
  confirmCreate: (data: {
    packageName: string;
    name: string;
    description: string;
    stereotype?: string;
  }) => Promise<void>;
  cancelCreate: () => void;
}

export function useCytoscapeEntityCreation(
  cyRef: React.RefObject<Core | null>,
  options: {
    packageOptions: string[];
    defaultPackage: string;
    onEntityCreated?: () => void;
  },
): EntityCreationState {
  const [pending, setPending] = useState<PendingCreate | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Background right-click → open create modal at the click position
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const onBgCxttap = (evt: any) => {
      // Only when the user right-clicked on empty canvas, not on a node or edge
      if (evt.target !== cy) return;
      const pos = evt.position;
      const opts = optionsRef.current;
      setPending({
        packageOptions: opts.packageOptions,
        defaultPackage: opts.defaultPackage,
        position: pos ? { x: pos.x, y: pos.y } : null,
      });
    };

    cy.on('cxttap', onBgCxttap);
    return () => {
      cy.off('cxttap', onBgCxttap);
    };
  }, [cyRef]);

  const startCreate = useCallback(
    (defaultPackage: string, position?: { x: number; y: number }) => {
      const opts = optionsRef.current;
      setPending({
        packageOptions: opts.packageOptions,
        defaultPackage: defaultPackage || opts.defaultPackage,
        position: position ?? null,
      });
    },
    [],
  );

  const cancelCreate = useCallback(() => {
    setPending(null);
  }, []);

  const confirmCreate = useCallback(
    async (data: { packageName: string; name: string; description: string; stereotype?: string }) => {
      if (!pending) return;
      const entity: Entity = {
        uuid: crypto.randomUUID(),
        name: data.name,
        description: data.description || undefined,
        stereotype: data.stereotype || undefined,
        attributes: [],
      };

      try {
        await servicesApi.createEntity(data.packageName, entity);

        const cy = cyRef.current;
        if (cy) {
          const pos = pending.position ?? {
            x: cy.width() / 2 + (cy.pan().x ? -cy.pan().x : 0),
            y: cy.height() / 2 + (cy.pan().y ? -cy.pan().y : 0),
          };
          cy.add({
            group: 'nodes',
            data: {
              id: entity.uuid,
              label: entity.name,
              displayLabel: `${entity.name}\n0 attrs`,
              service: data.packageName,
              type: 'entity',
              attrCount: 0,
              pkCount: 0,
              description: entity.description ?? '',
              attributes: [],
              expanded: false,
            },
            position: pos,
          });
          // Brief highlight pulse so the user can spot the new node
          const node = cy.getElementById(entity.uuid);
          node.addClass('highlighted');
          setTimeout(() => node.removeClass('highlighted'), 1800);
        }

        setPending(null);
        optionsRef.current.onEntityCreated?.();
      } catch (err) {
        console.error('Failed to create entity:', err);
      }
    },
    [pending, cyRef],
  );

  return { pending, startCreate, confirmCreate, cancelCreate };
}
