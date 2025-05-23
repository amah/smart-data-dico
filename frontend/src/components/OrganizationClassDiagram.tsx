import React, { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

const OrganizationClassDiagram: React.FC = () => {
  const diagramRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Initialize mermaid
    mermaid.initialize({
      theme: 'neutral',
      securityLevel: 'loose',
      logLevel: 'debug',
      fontFamily: 'Arial, sans-serif',
      fontSize: 14,
      themeVariables: {
        classDiagramBackground: '#f8f9fa',
        primaryColor: '#4a86e8',
        primaryTextColor: '#333',
        primaryBorderColor: '#7b8a96',
        lineColor: '#7b8a96',
        secondaryColor: '#f5f5f5',
        tertiaryColor: '#fff'
      }
    });

    // Define the class diagram
    const diagram = `
    classDiagram
      direction TB
      
      %% Inheritance relationships
      Person <|-- Patient
      Person <|-- Staff
      
      %% Composition relationships with multiplicity
      Hospital "1" *-- "1" Department : has
      Department "1" *-- "*" Staff : employs
      
      %% Staff inheritance hierarchy
      Staff <|-- OperationsStaff
      Staff <|-- AdministrativeStaff
      Staff <|-- TechnicalStaff
      
      %% Operations staff hierarchy
      OperationsStaff <|-- Doctor
      OperationsStaff <|-- Nurse
      Doctor <|-- Surgeon
      
      %% Administrative staff hierarchy
      AdministrativeStaff <|-- FrontDeskStaff
      FrontDeskStaff <|-- Receptionist
      
      %% Technical staff hierarchy
      TechnicalStaff <|-- Technician
      TechnicalStaff <|-- Technologist
      Technologist <|-- SurgicalTechnologist
      
      %% Class definitions with attributes
      class Organization {
      }
      
      class Person {
        title: String
        givenName: String
        middleName: String
        familyName: String
        name: FullName
        birthDate: Date
        gender: Gender
        homeAddress: Address
        phone: Phone
      }
      
      class Hospital {
        name: String
        address: Address
        phone: Phone
      }
      
      class Department {
      }
      
      class Staff {
        joined: Date
        education: String(array)
        certification: String(array)
        languages: String(array)
      }
      
      class Patient {
        id: String
        name: FullName
        gender: Gender
        birthDate: Date
        age: Integer
        accepted: Date
        sickness: History
        prescriptions: String(array)
        allergies: String(array)
        specialReqs: String(array)
      }
      
      class OperationsStaff {
      }
      
      class AdministrativeStaff {
      }
      
      class TechnicalStaff {
      }
      
      class Doctor {
        specialty: String(array)
        locations: String(array)
      }
      
      class Nurse {
      }
      
      class FrontDeskStaff {
      }
      
      class Technician {
      }
      
      class Technologist {
      }
      
      class Surgeon {
      }
      
      class Receptionist {
      }
      
      class SurgicalTechnologist {
      }
      
      %% Define relationship between Person and Hospital
      Person "*" -- "*" Hospital
    `;

    // Render the diagram
    if (diagramRef.current) {
      mermaid.render('organization-diagram', diagram)
        .then(({ svg }) => {
          if (diagramRef.current) {
            diagramRef.current.innerHTML = svg;
          }
        })
        .catch(err => {
          console.error('Error rendering diagram:', err);
          if (diagramRef.current) {
            diagramRef.current.innerHTML = `
              <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
                <strong class="font-bold">Error rendering diagram:</strong>
                <span class="block sm:inline"> ${err.message}</span>
              </div>
            `;
          }
        });
    }
  }, []);

  return (
    <div className="w-full overflow-auto">
      <div
        ref={diagramRef}
        className="organization-diagram"
        style={{ minHeight: 600, width: '100%' }}
      ></div>
    </div>
  );
};

export default OrganizationClassDiagram;