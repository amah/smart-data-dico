import { useEffect, useState, useCallback, useRef } from 'react';
import type { Core } from 'cytoscape';
import { relationshipApi } from '../../services/api';
import type { Relationship, Cardinality } from '../../types';

interface EdgeCreationState {
  /** Currently in "connect mode" — waiting for target click */
  connecting: boolean;
  /** Source node info for the pending connection */
  sourceNode: { id: string; label: string; service: string } | null;
  /** Context menu state */
  contextMenu: { x: number; y: number; nodeId: string; nodeLabel: string; nodeService: string } | null;
  /** When both source and target are selected, show the modal */
  pendingEdge: { sourceId: string; sourceLabel: string; targetId: string; targetLabel: string; service: string } | null;
  /** Start connect mode from context menu */
  startConnect: () => void;
  /** Cancel connect mode */
  cancelConnect: () => void;
  /** Close context menu */
  closeContextMenu: () => void;
  /** Confirm relationship creation */
  confirmEdge: (data: { description: string; sourceCardinality: Cardinality; targetCardinality: Cardinality; sourceName: string; targetName: string }) => Promise<void>;
  /** Cancel edge creation */
  cancelEdge: () => void;
}

export function useCytoscapeEdgeCreation(
  cyRef: React.RefObject<Core | null>,
  onEdgeCreated?: () => void,
): EdgeCreationState {
  const [connecting, setConnecting] = useState(false);
  const [sourceNode, setSourceNode] = useState<EdgeCreationState['sourceNode']>(null);
  const [contextMenu, setContextMenu] = useState<EdgeCreationState['contextMenu']>(null);
  const [pendingEdge, setPendingEdge] = useState<EdgeCreationState['pendingEdge']>(null);
  const connectingRef = useRef(false);
  const sourceNodeRef = useRef<EdgeCreationState['sourceNode']>(null);

  // Keep refs in sync for use in event handlers
  useEffect(() => {
    connectingRef.current = connecting;
    sourceNodeRef.current = sourceNode;
  }, [connecting, sourceNode]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Right-click context menu
    const onCxttap = (evt: any) => {
      const node = evt.target;
      if (!node.isNode || !node.isNode() || node.isParent()) return;

      const renderedPos = node.renderedPosition();
      const container = cy.container();
      const rect = container?.getBoundingClientRect();

      setContextMenu({
        x: (rect?.left || 0) + renderedPos.x,
        y: (rect?.top || 0) + renderedPos.y,
        nodeId: node.id(),
        nodeLabel: node.data('label'),
        nodeService: node.data('service'),
      });
    };

    // In connect mode, clicking a node completes the connection
    const onNodeTapForConnect = (evt: any) => {
      if (!connectingRef.current || !sourceNodeRef.current) return;

      const targetNode = evt.target;
      if (!targetNode.isNode || !targetNode.isNode() || targetNode.isParent()) return;
      if (targetNode.id() === sourceNodeRef.current.id) return; // Can't connect to self

      evt.stopPropagation();

      setPendingEdge({
        sourceId: sourceNodeRef.current.id,
        sourceLabel: sourceNodeRef.current.label,
        targetId: targetNode.id(),
        targetLabel: targetNode.data('label'),
        service: sourceNodeRef.current.service,
      });

      setConnecting(false);
      setSourceNode(null);
      // Remove visual hint
      cy.nodes().removeClass('connect-source connect-target-hint');
    };

    // Background click cancels connect mode
    const onBgTapForConnect = (evt: any) => {
      if (!connectingRef.current) return;
      if (evt.target === cy) {
        setConnecting(false);
        setSourceNode(null);
        cy.nodes().removeClass('connect-source connect-target-hint');
      }
    };

    cy.on('cxttap', 'node[type = "entity"]', onCxttap);
    cy.on('tap', 'node[type = "entity"]', onNodeTapForConnect);
    cy.on('tap', onBgTapForConnect);

    return () => {
      cy.off('cxttap', 'node[type = "entity"]', onCxttap);
      cy.off('tap', 'node[type = "entity"]', onNodeTapForConnect);
      cy.off('tap', onBgTapForConnect);
    };
  }, [cyRef]);

  const startConnect = useCallback(() => {
    if (!contextMenu) return;
    const cy = cyRef.current;

    setSourceNode({
      id: contextMenu.nodeId,
      label: contextMenu.nodeLabel,
      service: contextMenu.nodeService,
    });
    setConnecting(true);
    setContextMenu(null);

    // Visual: highlight source, dim others
    if (cy) {
      cy.nodes().removeClass('connect-source connect-target-hint');
      cy.getElementById(contextMenu.nodeId).addClass('connect-source');
      cy.nodes('[type = "entity"]').not(`#${contextMenu.nodeId}`).addClass('connect-target-hint');
    }
  }, [contextMenu, cyRef]);

  const cancelConnect = useCallback(() => {
    setConnecting(false);
    setSourceNode(null);
    cyRef.current?.nodes().removeClass('connect-source connect-target-hint');
  }, [cyRef]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const confirmEdge = useCallback(async (data: {
    description: string;
    sourceCardinality: Cardinality;
    targetCardinality: Cardinality;
    sourceName: string;
    targetName: string;
  }) => {
    if (!pendingEdge) return;

    const relationship: Relationship = {
      uuid: crypto.randomUUID(),
      description: data.description,
      source: {
        entity: pendingEdge.sourceId,
        cardinality: data.sourceCardinality,
        name: data.sourceName || undefined,
      },
      target: {
        entity: pendingEdge.targetId,
        cardinality: data.targetCardinality,
        name: data.targetName || undefined,
      },
    };

    try {
      await relationshipApi.createRelationship(pendingEdge.service, relationship);

      // Add edge to graph immediately
      const cy = cyRef.current;
      if (cy) {
        cy.add({
          group: 'edges',
          data: {
            id: relationship.uuid,
            source: pendingEdge.sourceId,
            target: pendingEdge.targetId,
            label: data.description,
            sourceCardinality: data.sourceCardinality,
            targetCardinality: data.targetCardinality,
          },
        });
      }

      setPendingEdge(null);
      onEdgeCreated?.();
    } catch (err) {
      console.error('Failed to create relationship:', err);
    }
  }, [pendingEdge, cyRef, onEdgeCreated]);

  const cancelEdge = useCallback(() => {
    setPendingEdge(null);
  }, []);

  return {
    connecting,
    sourceNode,
    contextMenu,
    pendingEdge,
    startConnect,
    cancelConnect,
    closeContextMenu,
    confirmEdge,
    cancelEdge,
  };
}
