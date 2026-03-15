import React from 'react';
import OrganizationDiagramEditor from '../components/OrganizationDiagramEditor';

const OrganizationDiagramPage: React.FC = () => {
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Organization Class Diagram</h1>
      <div className="bg-base-100 p-4 rounded shadow-md">
        <OrganizationDiagramEditor />
      </div>
    </div>
  );
};

export default OrganizationDiagramPage;