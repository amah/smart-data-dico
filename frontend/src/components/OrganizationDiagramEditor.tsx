import React, { useCallback, useState } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  Connection,
  Edge,
  Node,
  NodeChange,
  EdgeChange,
  NodeTypes,
  Position,
  MarkerType,
  Handle,
} from 'reactflow';
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

const initialNodes: Node[] = [
  {
    id: 'Person',
    type: 'classNode',
    data: { label: 'Person', attributes: [
      'title: String',
      'givenName: String',
      'middleName: String',
      'familyName: String',
      'name: FullName',
      'birthDate: Date',
      'gender: Gender',
      'homeAddress: Address',
      'phone: Phone'
    ] },
    position: { x: 0, y: 0 }
  },
  {
    id: 'Patient',
    type: 'classNode',
    data: { label: 'Patient', attributes: [
      'id: String',
      'name: FullName',
      'gender: Gender',
      'birthDate: Date',
      'age: Integer',
      'accepted: Date',
      'sickness: History',
      'prescriptions: String(array)',
      'allergies: String(array)',
      'specialReqs: String(array)'
    ] },
    position: { x: 300, y: 0 }
  },
  {
    id: 'Staff',
    type: 'classNode',
    data: { label: 'Staff', attributes: [
      'joined: Date',
      'education: String(array)',
      'certification: String(array)',
      'languages: String(array)'
    ] },
    position: { x: 0, y: 250 }
  },
  {
    id: 'Hospital',
    type: 'classNode',
    data: { label: 'Hospital', attributes: [
      'name: String',
      'address: Address',
      'phone: Phone'
    ] },
    position: { x: 600, y: 0 }
  },
  {
    id: 'Department',
    type: 'classNode',
    data: { label: 'Department', attributes: [] },
    position: { x: 600, y: 200 }
  },
  // Add more nodes for hierarchy (OperationsStaff, Doctor, etc.) as needed
];

const initialEdges: Edge[] = [
  // Inheritance
  { id: 'Person-Patient', source: 'Person', target: 'Patient', label: 'inherits', animated: false, style: { stroke: primaryColor, strokeDasharray: '6 6', strokeWidth: 2 } },
  { id: 'Person-Staff', source: 'Person', target: 'Staff', label: 'inherits', animated: false, style: { stroke: primaryColor, strokeDasharray: '6 6', strokeWidth: 2 } },
  // Composition
  { id: 'Hospital-Department', source: 'Hospital', target: 'Department', label: 'has', animated: false, style: { stroke: borderColor, strokeDasharray: '6 6', strokeWidth: 2 } },
  { id: 'Department-Staff', source: 'Department', target: 'Staff', label: 'employs', animated: false, style: { stroke: borderColor, strokeDasharray: '6 6', strokeWidth: 2 } },
  // Person-Hospital association
  { id: 'Person-Hospital', source: 'Person', target: 'Hospital', label: '', animated: false, style: { stroke: borderColor, strokeDasharray: '6 6', strokeWidth: 2 } },
  // Add more edges for hierarchy as needed
];

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

const OrganizationDiagramEditor: React.FC = () => {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

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