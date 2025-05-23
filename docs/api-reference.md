# Data Dictionary Management System - API Reference

This document provides detailed information about the RESTful API endpoints available in the Data Dictionary Management System.

## Base URL

All API endpoints are relative to the base URL:

```
https://your-domain.com/api
```

## Authentication

Most API endpoints require authentication. The API uses JWT (JSON Web Token) for authentication.

### Obtaining a Token

```http
POST /auth/login
Content-Type: application/json

{
  "username": "your-username",
  "password": "your-password"
}
```

**Response**:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-id",
    "username": "your-username",
    "role": "admin"
  }
}
```

### Using the Token

Include the token in the Authorization header for all authenticated requests:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Error Handling

The API uses standard HTTP status codes to indicate the success or failure of a request.

Common status codes:

- `200 OK`: The request was successful
- `201 Created`: A resource was successfully created
- `400 Bad Request`: The request was invalid
- `401 Unauthorized`: Authentication is required or failed
- `403 Forbidden`: The authenticated user doesn't have permission
- `404 Not Found`: The requested resource was not found
- `500 Internal Server Error`: An error occurred on the server

Error responses include a JSON body with details:

```json
{
  "message": "Error message",
  "error": "Detailed error information (only in development mode)"
}
```

## API Endpoints

### Services

#### Get All Services

Retrieves a list of all services (microservices).

```http
GET /services
```

**Response**:

```json
[
  {
    "id": "user-service",
    "name": "User Service",
    "entityCount": 2
  },
  {
    "id": "product-service",
    "name": "Product Service",
    "entityCount": 1
  }
]
```

#### Get Service Entities

Retrieves all entities for a specific service.

```http
GET /services/{service}/entities
```

**Parameters**:
- `service`: The service ID

**Response**:

```json
[
  {
    "id": "User",
    "name": "User",
    "description": "User entity"
  },
  {
    "id": "Profile",
    "name": "Profile",
    "description": "User profile entity"
  }
]
```

### Entities

#### Get Entity Schema

Retrieves the schema for a specific entity.

```http
GET /services/{service}/entities/{entity}
```

**Parameters**:
- `service`: The service ID
- `entity`: The entity ID

**Response**:

```json
{
  "id": "User",
  "name": "User",
  "description": "User entity",
  "microservice": "user-service",
  "version": "1.0.0",
  "attributes": [
    {
      "name": "id",
      "description": "User ID",
      "type": "string",
      "required": true
    },
    {
      "name": "email",
      "description": "User email",
      "type": "string",
      "format": "email",
      "required": true
    }
  ],
  "relationships": [
    {
      "name": "profile",
      "description": "User profile",
      "type": "hasOne",
      "target": "Profile",
      "required": false
    }
  ]
}
```

#### Create Entity

Creates a new entity.

```http
POST /services/{service}/entities
Content-Type: application/json
Authorization: Bearer your-token

{
  "id": "NewEntity",
  "name": "New Entity",
  "description": "A new entity",
  "microservice": "service-name",
  "version": "1.0.0",
  "attributes": [
    {
      "name": "id",
      "description": "Entity ID",
      "type": "string",
      "required": true
    }
  ]
}
```

**Parameters**:
- `service`: The service ID

**Response**:

```json
{
  "message": "Entity created successfully",
  "entity": {
    "id": "NewEntity",
    "name": "New Entity",
    "description": "A new entity",
    "microservice": "service-name",
    "version": "1.0.0"
  }
}
```

#### Update Entity

Updates an existing entity.

```http
PUT /services/{service}/entities/{entity}
Content-Type: application/json
Authorization: Bearer your-token

{
  "id": "ExistingEntity",
  "name": "Updated Entity",
  "description": "An updated entity",
  "microservice": "service-name",
  "version": "1.0.1",
  "attributes": [
    {
      "name": "id",
      "description": "Entity ID",
      "type": "string",
      "required": true
    },
    {
      "name": "name",
      "description": "Entity name",
      "type": "string",
      "required": true
    }
  ]
}
```

**Parameters**:
- `service`: The service ID
- `entity`: The entity ID

**Response**:

```json
{
  "message": "Entity updated successfully",
  "entity": {
    "id": "ExistingEntity",
    "name": "Updated Entity",
    "description": "An updated entity",
    "microservice": "service-name",
    "version": "1.0.1"
  }
}
```

#### Delete Entity

Deletes an entity.

```http
DELETE /services/{service}/entities/{entity}
Authorization: Bearer your-token
```

**Parameters**:
- `service`: The service ID
- `entity`: The entity ID

**Response**:

```json
{
  "message": "Entity deleted successfully"
}
```

### Search

#### Search Entities

Searches for entities, attributes, and relationships.

```http
GET /search?q={query}
```

**Parameters**:
- `q`: The search query

**Optional Parameters**:
- `service`: Filter by service
- `type`: Filter by type (entity, attribute, relationship)

**Response**:

```json
[
  {
    "type": "entity",
    "entityName": "User",
    "microservice": "user-service",
    "name": "User",
    "description": "User entity",
    "path": "/services/user-service/entities/User",
    "matchContext": "User entity for authentication"
  },
  {
    "type": "attribute",
    "entityName": "User",
    "microservice": "user-service",
    "name": "email",
    "description": "User email address",
    "path": "/services/user-service/entities/User",
    "matchContext": "email: User email address"
  }
]
```

### Version Control

#### Get Commit History

Retrieves the commit history.

```http
GET /history
```

**Optional Parameters**:
- `limit`: Maximum number of commits to return (default: 10)
- `offset`: Number of commits to skip (default: 0)

**Response**:

```json
[
  {
    "hash": "abc123",
    "message": "Updated User entity",
    "author": "John Doe",
    "date": "2023-01-01T12:00:00Z",
    "changes": {
      "added": [],
      "modified": ["user-service/User.yaml"],
      "deleted": []
    }
  },
  {
    "hash": "def456",
    "message": "Added Product entity",
    "author": "Jane Smith",
    "date": "2022-12-31T10:30:00Z",
    "changes": {
      "added": ["product-service/Product.yaml"],
      "modified": [],
      "deleted": []
    }
  }
]
```

#### Create Commit

Creates a new commit with the current changes.

```http
POST /commit
Content-Type: application/json
Authorization: Bearer your-token

{
  "message": "Commit message",
  "author": "Author Name"
}
```

**Response**:

```json
{
  "message": "Changes committed successfully",
  "commit": {
    "hash": "ghi789",
    "message": "Commit message",
    "author": "Author Name",
    "date": "2023-01-02T09:15:00Z",
    "changes": {
      "added": ["new-service/NewEntity.yaml"],
      "modified": ["user-service/User.yaml"],
      "deleted": []
    }
  }
}
```

#### Revert to Commit

Reverts to a previous commit.

```http
POST /revert
Content-Type: application/json
Authorization: Bearer your-token

{
  "commitId": "abc123"
}
```

**Response**:

```json
{
  "message": "Reverted to commit abc123",
  "commit": {
    "hash": "jkl012",
    "message": "Revert to: Updated User entity",
    "author": "System",
    "date": "2023-01-03T14:20:00Z"
  }
}
```

### Graph Data

#### Get Graph Data

Retrieves graph data for visualization.

```http
GET /graph/{service}
```

**Parameters**:
- `service`: The service ID

**Response**:

```json
{
  "nodes": [
    {
      "id": "User",
      "label": "User",
      "type": "entity",
      "microservice": "user-service"
    },
    {
      "id": "Profile",
      "label": "Profile",
      "type": "entity",
      "microservice": "user-service"
    }
  ],
  "edges": [
    {
      "id": "User-Profile",
      "source": "User",
      "target": "Profile",
      "label": "hasOne",
      "type": "hasOne"
    }
  ]
}
```

## Rate Limiting

The API implements rate limiting to prevent abuse. The current limits are:

- 100 requests per minute for authenticated users
- 20 requests per minute for unauthenticated users

When a rate limit is exceeded, the API returns a `429 Too Many Requests` status code.

## Pagination

Endpoints that return lists of items support pagination using the following query parameters:

- `limit`: Maximum number of items to return (default: 20, max: 100)
- `offset`: Number of items to skip (default: 0)

Example:

```http
GET /services?limit=10&offset=20
```

The response includes pagination metadata:

```json
{
  "data": [...],
  "pagination": {
    "total": 45,
    "limit": 10,
    "offset": 20,
    "next": "/services?limit=10&offset=30",
    "prev": "/services?limit=10&offset=10"
  }
}
```

## Filtering

Some endpoints support filtering using query parameters. The specific filters available depend on the endpoint.

Example:

```http
GET /services/{service}/entities?type=string&required=true
```

## Sorting

Some endpoints support sorting using the `sort` query parameter. The value should be the field to sort by, with an optional `-` prefix for descending order.

Example:

```http
GET /services/{service}/entities?sort=-name
```

## Versioning

The API is versioned using URL path versioning. The current version is v1.

```
https://your-domain.com/api/v1/services
```

If no version is specified, the latest version is used.