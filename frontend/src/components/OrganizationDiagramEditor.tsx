import React, { useCallback, useEffect, useState } from 'react';
import ReactFlow, { addEdge, applyEdgeChanges, applyNodeChanges, Background, Connection, Controls, Edge, EdgeChange, Handle, MarkerType, MiniMap, Node, NodeChange, NodeTypes, Position } from 'reactflow';

import { Entity, Package } from '../types';

import 'reactflow/dist/style.css';

// Style constants for React Flow site look
const nodeColor = '#fff';
const borderColor = '#e0e7ef';
const primaryColor = '#0a2540';
const textColor = '#22223b';
const nodeShadow = '0 2px 8px 0 rgba(60,60,60,0.07)';
const headerBg = '#fff';
const headerText = '#22223b';
const dividerColor = '#e0e7ef';

// Custom node for React Flow site style
const ClassNode = ({ data }: any) => (
  <div
    style={{
      background: nodeColor,
      border: `1.5px solid ${borderColor}`,
      borderRadius: 16,
      boxShadow: nodeShadow,
      minWidth: 220,
      fontFamily: 'Inter, Arial, sans-serif',
      color: textColor,
      padding: 0,
      overflow: 'hidden',
      position: 'relative'
    }}
  >
    <div
      style={{
        background: headerBg,
        color: headerText,
        fontWeight: 700,
        fontSize: 16,
        padding: '14px 18px 8px 18px',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        letterSpacing: '-0.5px',
      }}
    >
      {data.label}
    </div>
    <div
      style={{
        borderBottom: `1.5px solid ${dividerColor}`,
        margin: '0 18px',
      }}
    />
    <div style={{ padding: '10px 18px 14px 18px', fontSize: 14 }}>
      {data.attributes && data.attributes.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {data.attributes.map((attr: string, idx: number) => (
            <li key={idx} style={{ marginBottom: 2, color: '#6c6f7b' }}>{attr}</li>
          ))}
        </ul>
      )}
    </div>
    {/* Handles for connections */}
    <Handle type="target" position={Position.Left} style={{ background: '#222', width: 10, height: 10, borderRadius: '50%' }} />
    <Handle type="source" position={Position.Right} style={{ background: '#222', width: 10, height: 10, borderRadius: '50%' }} />
  </div>
);

const nodeTypes: NodeTypes = {
  classNode: ClassNode,
};

// Utility to flatten package/entity hierarchy into nodes and edges
function flattenPackagesToDiagram(packages: Package[], x = 0, y = 0, level = 0) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let offsetY = y;

  for (const pkg of packages) {
    const pkgNodeId = `pkg-${pkg.id}`;
    nodes.push({
      id: pkgNodeId,
      type: 'classNode',
      data: { label: pkg.name, attributes: [pkg.description || ''] },
      position: { x: x + level * 200, y: offsetY },
    });

    // Add entity nodes
    if (pkg.entities) {
      for (const entity of pkg.entities) {
        const entityNodeId = `entity-${entity.uuid}`;
        nodes.push({
          id: entityNodeId,
          type: 'classNode',
          data: {
            label: entity.name,
            attributes: entity.attributes?.map(a => `${a.name}: ${a.type}`) || [],
          },
          position: { x: x + (level + 1) * 200, y: offsetY },
        });
        // Edge from package to entity
        edges.push({
          id: `${pkgNodeId}-${entityNodeId}`,
          source: pkgNodeId,
          target: entityNodeId,
          label: 'contains',
          animated: false,
          style: { stroke: borderColor, strokeDasharray: '6 6', strokeWidth: 2 }
        });
        offsetY += 120;
      }
    }

    // Recurse into sub-packages
    if (pkg.subPackages && pkg.subPackages.length > 0) {
      const { nodes: subNodes, edges: subEdges } = flattenPackagesToDiagram(pkg.subPackages, x, offsetY, level + 1);
      nodes.push(...subNodes);
      edges.push(...subEdges);
      offsetY += subNodes.length * 120;
      // Edge from parent package to sub-packages
      for (const subPkg of pkg.subPackages) {
        edges.push({
          id: `${pkgNodeId}-pkg-${subPkg.id}`,
          source: pkgNodeId,
          target: `pkg-${subPkg.id}`,
          label: 'sub-package',
          animated: false,
          style: { stroke: primaryColor, strokeDasharray: '6 6', strokeWidth: 2 }
        });
      }
    } else {
      offsetY += 120;
    }
  }

  return { nodes, edges };
}

interface OrganizationDiagramEditorProps {
  packages: Package[];
}

const OrganizationDiagramEditor: React.FC<OrganizationDiagramEditorProps> = ({ packages }) => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    const { nodes, edges } = flattenPackagesToDiagram(packages);
    setNodes(nodes);
    setEdges(edges);
  }, [packages]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, style: { stroke: primaryColor, strokeDasharray: '6 6', strokeWidth: 2 } }, eds)),
    []
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  return (
    <div
      style={{
        width: '100%',
        height: '700px',
        background: 'radial-gradient(ellipse at 60% 40%, #f8f9fa 60%, #f5e9f7 100%)',
        borderRadius: 16,
        border: `1.5px solid #e0e7ef`,
        boxShadow: '0 2px 16px 0 rgba(60,60,60,0.07)'
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#bdbdbd', strokeDasharray: '6 6', strokeWidth: 2 }
        }}
      >
        <MiniMap nodeColor={n => primaryColor} />
        <Controls />
        <Background color="#e0e7ef" gap={24} />
      </ReactFlow>
    </div>
  );
};

export default OrganizationDiagramEditor;