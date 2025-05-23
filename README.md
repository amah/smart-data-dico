# Data Dictionary Management System

A comprehensive system for managing data dictionaries across your organization. This project provides tools for creating, editing, versioning, and sharing data dictionaries.

## Project Structure

The project is organized into two main directories:

- `backend/`: Node.js backend with Express and TypeScript
- `frontend/`: React frontend with Vite, TypeScript, and Tailwind CSS

### Backend Structure

```
backend/
├── src/
│   ├── controllers/    # Request handlers
│   ├── models/         # Data models and interfaces
│   ├── routes/         # API routes
│   ├── services/       # Business logic
│   ├── utils/          # Utility functions
│   └── server.ts       # Main server file
├── package.json        # Dependencies and scripts
└── tsconfig.json       # TypeScript configuration
```

### Frontend Structure

```
frontend/
├── src/
│   ├── assets/         # Static assets
│   ├── components/     # Reusable UI components
│   ├── hooks/          # Custom React hooks
│   ├── pages/          # Page components
│   ├── services/       # API services
│   ├── types/          # TypeScript type definitions
│   ├── utils/          # Utility functions
│   ├── App.tsx         # Main application component
│   ├── main.tsx        # Entry point
│   └── index.css       # Global styles
├── index.html          # HTML template
├── package.json        # Dependencies and scripts
├── tailwind.config.js  # Tailwind CSS configuration
└── tsconfig.json       # TypeScript configuration
```

## Setup Instructions

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Backend Setup

1. Navigate to the backend directory:
   ```
   cd backend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file (already done with basic configuration)

4. Start the development server:
   ```
   npm run dev
   ```

The backend server will run on http://localhost:3001 by default.

### Frontend Setup

1. Navigate to the frontend directory:
   ```
   cd frontend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the development server:
   ```
   npm run dev
   ```

The frontend development server will run on http://localhost:3000 by default.

## Development

- Backend: The Express server will automatically restart when changes are made (using nodemon)
- Frontend: The Vite development server includes hot module replacement for fast updates

## Features

- Centralized repository for data dictionaries
- Version control for tracking changes
- User-friendly interface for creating and editing dictionaries
- Export capabilities for sharing dictionaries in various formats
- API for programmatic access to dictionaries

## Technologies Used

### Backend
- Node.js
- Express
- TypeScript
- simple-git (for version control)
- YAML/JSON parsing

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS
- DaisyUI
- React Router
- Axios