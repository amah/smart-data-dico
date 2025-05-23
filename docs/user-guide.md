# Data Dictionary Management System - User Guide

This guide provides comprehensive instructions for using the Data Dictionary Management System.

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Navigation](#navigation)
4. [Working with Services](#working-with-services)
5. [Managing Entities](#managing-entities)
6. [Attributes and Relationships](#attributes-and-relationships)
7. [Version Control](#version-control)
8. [Visualization](#visualization)
9. [Search](#search)
10. [API Reference](#api-reference)
11. [Troubleshooting](#troubleshooting)

## Introduction

The Data Dictionary Management System is a comprehensive tool for managing data dictionaries across your organization. It provides a centralized repository for defining, documenting, and versioning data entities, attributes, and relationships.

### Key Features

- Centralized repository for data dictionaries
- Version control for tracking changes
- User-friendly interface for creating and editing dictionaries
- Visualization of entity relationships
- Export capabilities for sharing dictionaries
- API for programmatic access

## Getting Started

### Accessing the System

1. Open your web browser and navigate to the application URL
2. Log in with your credentials
3. You will be directed to the home page showing an overview of your data dictionaries

### User Roles

The system supports three user roles:

- **Viewer**: Can view all data dictionaries but cannot make changes
- **Editor**: Can view and edit data dictionaries
- **Admin**: Has full access, including user management and system configuration

## Navigation

### Main Navigation

The main navigation menu is located on the left side of the screen and provides access to:

- **Home**: Overview dashboard
- **Services**: List of microservices
- **Entities**: All entities across services
- **Visualization**: Entity relationship diagrams
- **Version Control**: Commit history and version management
- **Settings**: User preferences and system settings

### Breadcrumb Navigation

Breadcrumb navigation at the top of each page helps you understand your current location and navigate back to previous levels.

## Working with Services

Services (or microservices) are the top-level organizational units in the system.

### Viewing Services

1. Click on "Services" in the main navigation
2. The services page displays all available microservices
3. Each service shows the number of entities it contains

### Service Details

Click on a service name to view its details, including:

- Service description
- List of entities
- Recent changes
- Service metadata

## Managing Entities

Entities represent the data structures in your system.

### Viewing Entities

1. Navigate to a service
2. The entities page displays all entities for the selected service
3. Each entity shows its name, description, and attribute count

### Creating a New Entity

1. Navigate to the service where you want to create the entity
2. Click the "New Entity" button
3. Fill in the entity details:
   - Name: A unique identifier for the entity
   - Description: A clear description of what the entity represents
   - Version: The initial version number
4. Add attributes (see [Attributes and Relationships](#attributes-and-relationships))
5. Click "Save" to create the entity

### Editing an Entity

1. Navigate to the entity you want to edit
2. Click the "Edit" button
3. Modify the entity details
4. Click "Save" to update the entity

### Deleting an Entity

1. Navigate to the entity you want to delete
2. Click the "Delete" button
3. Confirm the deletion
4. Note: Deletion is permanent and will remove all versions of the entity

## Attributes and Relationships

### Managing Attributes

Attributes define the properties of an entity.

#### Adding an Attribute

1. In the entity editor, scroll to the Attributes section
2. Click "Add Attribute"
3. Fill in the attribute details:
   - Name: A unique identifier for the attribute
   - Description: What the attribute represents
   - Type: The data type (string, number, boolean, etc.)
   - Required: Whether the attribute is mandatory
   - Format: Additional format information (e.g., email, date)
   - Default Value: The default value, if any
   - Examples: Sample values
4. Click "Add" to add the attribute

#### Editing an Attribute

1. In the entity editor, find the attribute you want to edit
2. Click the "Edit" button next to the attribute
3. Modify the attribute details
4. Click "Save" to update the attribute

#### Deleting an Attribute

1. In the entity editor, find the attribute you want to delete
2. Click the "Delete" button next to the attribute
3. Confirm the deletion

### Managing Relationships

Relationships define how entities are connected to each other.

#### Adding a Relationship

1. In the entity editor, scroll to the Relationships section
2. Click "Add Relationship"
3. Fill in the relationship details:
   - Name: A descriptive name for the relationship
   - Type: The relationship type (hasOne, hasMany, belongsTo, manyToMany)
   - Target Entity: The entity this relationship connects to
   - Inverse Name: The name of the relationship from the target's perspective
   - Required: Whether the relationship is mandatory
4. Click "Add" to add the relationship

#### Editing a Relationship

1. In the entity editor, find the relationship you want to edit
2. Click the "Edit" button next to the relationship
3. Modify the relationship details
4. Click "Save" to update the relationship

#### Deleting a Relationship

1. In the entity editor, find the relationship you want to delete
2. Click the "Delete" button next to the relationship
3. Confirm the deletion

## Version Control

The system includes version control to track changes to your data dictionaries.

### Viewing Commit History

1. Click on "Version Control" in the main navigation
2. The history page displays all commits
3. Each commit shows:
   - Commit ID
   - Commit message
   - Author
   - Date and time
   - Changes made (entities added, modified, or deleted)

### Creating a Commit

1. Make changes to one or more entities
2. Click on "Version Control" in the main navigation
3. Click "Commit Changes"
4. Enter a commit message describing the changes
5. Click "Commit" to save the changes

### Reverting to a Previous Version

1. Click on "Version Control" in the main navigation
2. Find the commit you want to revert to
3. Click "Revert to this Version"
4. Confirm the reversion
5. Note: This will create a new commit that reverts to the selected version

## Visualization

The visualization feature helps you understand the relationships between entities.

### Viewing Entity Relationships

1. Click on "Visualization" in the main navigation
2. Select a service from the dropdown
3. The visualization displays all entities in the service and their relationships
4. Use the controls to zoom in/out and pan the diagram

### Customizing the Visualization

1. Click on "Settings" in the visualization toolbar
2. Adjust the display options:
   - Layout: How entities are arranged (hierarchical, force-directed, etc.)
   - Show Attributes: Whether to display entity attributes
   - Show Relationship Labels: Whether to display relationship names
   - Group by Microservice: Whether to group entities by service
3. Click "Apply" to update the visualization

### Exporting the Visualization

1. Click on "Export" in the visualization toolbar
2. Select the export format (PNG, SVG, or PDF)
3. Click "Export" to download the visualization

## Search

The search feature helps you find entities, attributes, and relationships.

### Basic Search

1. Enter a search term in the search box in the top navigation
2. Press Enter or click the search icon
3. The search results page displays matching entities, attributes, and relationships

### Advanced Search

1. Click on "Advanced" next to the search box
2. Specify search criteria:
   - Search in: Where to search (entities, attributes, relationships)
   - Service: Limit search to a specific service
   - Type: Limit search to a specific type (string, number, etc.)
   - Required: Limit search to required/optional fields
3. Click "Search" to execute the advanced search

## API Reference

The system provides a RESTful API for programmatic access to data dictionaries.

### Authentication

All API requests require authentication using a JWT token.

To obtain a token:

```
POST /api/auth/login
{
  "username": "your-username",
  "password": "your-password"
}
```

Include the token in subsequent requests:

```
Authorization: Bearer your-token
```

### API Endpoints

#### Services

- `GET /api/services`: Get all services
- `GET /api/services/:service`: Get service details
- `GET /api/services/:service/entities`: Get all entities for a service

#### Entities

- `GET /api/services/:service/entities/:entity`: Get entity details
- `POST /api/services/:service/entities`: Create a new entity
- `PUT /api/services/:service/entities/:entity`: Update an entity
- `DELETE /api/services/:service/entities/:entity`: Delete an entity

#### Version Control

- `GET /api/history`: Get commit history
- `POST /api/commit`: Create a new commit
- `POST /api/revert`: Revert to a previous commit

#### Search

- `GET /api/search?q=query`: Search for entities, attributes, and relationships

For detailed API documentation, refer to the Swagger documentation at `/api-docs`.

## Troubleshooting

### Common Issues

#### Login Issues

- Ensure you are using the correct username and password
- Check if your account is active
- Clear browser cookies and try again

#### Entity Not Saving

- Check if all required fields are filled
- Ensure you have the necessary permissions
- Check for validation errors in the form

#### Visualization Not Loading

- Check your browser console for errors
- Try refreshing the page
- Ensure your browser supports SVG and Canvas

### Getting Help

If you encounter issues not covered in this guide:

1. Check the FAQ section in the application
2. Contact your system administrator
3. Submit a support ticket through the "Help" menu