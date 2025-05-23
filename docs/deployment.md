# Deployment Guide for Data Dictionary Management System

This document provides instructions for deploying the Data Dictionary Management System to various environments.

## Prerequisites

- Node.js (v16 or higher)
- npm (v7 or higher)
- Git
- MongoDB (v4.4 or higher) or compatible database
- A server or cloud platform for hosting (AWS, Azure, GCP, Heroku, etc.)

## Environment Setup

### Environment Variables

The application requires several environment variables to be set. Create a `.env` file in the backend directory with the following variables:

```
# Server Configuration
PORT=3001
NODE_ENV=production

# Database Configuration
DB_URI=mongodb://username:password@hostname:port/database

# Authentication
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRATION=24h

# Git Configuration
GIT_ENABLED=true
GIT_USER_NAME=Your Name
GIT_USER_EMAIL=your.email@example.com

# Logging
LOG_LEVEL=info
```

### Directory Structure

Ensure the following directory structure is maintained:

```
/app
  /backend
    /dist        # Compiled TypeScript
    /node_modules
    .env
  /frontend
    /dist        # Built frontend assets
    /node_modules
  /data-dictionaries  # Directory for storing YAML files
```

## Deployment Options

### Option 1: Manual Deployment

1. **Build the application**:

   ```bash
   # Build backend
   cd backend
   npm ci
   npm run build

   # Build frontend
   cd ../frontend
   npm ci
   npm run build
   ```

2. **Deploy to server**:

   ```bash
   # Copy files to server
   scp -r backend/dist backend/package.json backend/package-lock.json user@server:/app/backend/
   scp -r frontend/dist user@server:/app/frontend/
   
   # Install production dependencies on server
   ssh user@server "cd /app/backend && npm ci --production"
   
   # Start the application
   ssh user@server "cd /app/backend && node dist/server.js"
   ```

3. **Set up a process manager** (recommended):

   Install PM2 on the server:

   ```bash
   npm install -g pm2
   ```

   Create a PM2 configuration file (`ecosystem.config.js`):

   ```javascript
   module.exports = {
     apps: [{
       name: "data-dictionary-api",
       script: "./dist/server.js",
       cwd: "/app/backend",
       env: {
         NODE_ENV: "production",
       },
       instances: "max",
       exec_mode: "cluster"
     }]
   };
   ```

   Start the application with PM2:

   ```bash
   pm2 start ecosystem.config.js
   ```

### Option 2: Docker Deployment

1. **Create a Dockerfile for the backend**:

   ```dockerfile
   FROM node:16-alpine

   WORKDIR /app

   COPY package*.json ./
   RUN npm ci --production

   COPY dist ./dist

   EXPOSE 3001

   CMD ["node", "dist/server.js"]
   ```

2. **Create a Dockerfile for the frontend**:

   ```dockerfile
   FROM nginx:alpine

   COPY dist /usr/share/nginx/html
   COPY nginx.conf /etc/nginx/conf.d/default.conf

   EXPOSE 80

   CMD ["nginx", "-g", "daemon off;"]
   ```

3. **Create a docker-compose.yml file**:

   ```yaml
   version: '3'

   services:
     backend:
       build: ./backend
       ports:
         - "3001:3001"
       environment:
         - NODE_ENV=production
         - PORT=3001
         - DB_URI=mongodb://mongo:27017/data-dictionary
         - JWT_SECRET=your_jwt_secret
       volumes:
         - ./data-dictionaries:/app/data-dictionaries
       depends_on:
         - mongo

     frontend:
       build: ./frontend
       ports:
         - "80:80"
       depends_on:
         - backend

     mongo:
       image: mongo:4.4
       ports:
         - "27017:27017"
       volumes:
         - mongo-data:/data/db

   volumes:
     mongo-data:
   ```

4. **Build and run with Docker Compose**:

   ```bash
   docker-compose up -d
   ```

### Option 3: Cloud Deployment

#### AWS Elastic Beanstalk

1. Install the EB CLI:

   ```bash
   pip install awsebcli
   ```

2. Initialize EB application:

   ```bash
   eb init
   ```

3. Create an environment:

   ```bash
   eb create production
   ```

4. Deploy:

   ```bash
   eb deploy
   ```

#### Heroku

1. Install the Heroku CLI:

   ```bash
   npm install -g heroku
   ```

2. Login to Heroku:

   ```bash
   heroku login
   ```

3. Create a Heroku app:

   ```bash
   heroku create data-dictionary-app
   ```

4. Add a Procfile to the backend directory:

   ```
   web: node dist/server.js
   ```

5. Deploy:

   ```bash
   git push heroku main
   ```

## Continuous Integration/Deployment

The repository includes GitHub Actions workflows for CI/CD. The workflow:

1. Runs linting and tests on both backend and frontend
2. Builds the application
3. Deploys to the development environment on successful builds from the main branch

To set up deployment to additional environments:

1. Add environment secrets in GitHub repository settings
2. Modify the `.github/workflows/ci-cd.yml` file to include additional deployment jobs

## Troubleshooting

### Common Issues

1. **Connection refused errors**:
   - Check if the server is running
   - Verify firewall settings
   - Ensure correct port configuration

2. **Database connection issues**:
   - Verify database credentials
   - Check network connectivity
   - Ensure database service is running

3. **File permission errors**:
   - Check permissions on the data-dictionaries directory
   - Ensure the application has write access

### Logs

- Application logs are available in the console and in log files
- For PM2-managed applications: `pm2 logs data-dictionary-api`
- For Docker: `docker-compose logs backend`

## Monitoring

Consider setting up monitoring using:

- PM2 monitoring: `pm2 monit`
- Prometheus and Grafana for metrics
- ELK stack for log aggregation

## Backup and Recovery

1. **Database Backup**:
   ```bash
   mongodump --uri="mongodb://username:password@hostname:port/database" --out=/backup/directory
   ```

2. **Data Dictionary Files Backup**:
   ```bash
   tar -czvf data-dictionaries-backup.tar.gz /app/data-dictionaries
   ```

3. **Recovery**:
   ```bash
   # Restore database
   mongorestore --uri="mongodb://username:password@hostname:port/database" /backup/directory
   
   # Restore data dictionary files
   tar -xzvf data-dictionaries-backup.tar.gz -C /
   ```

## Security Considerations

1. Always use HTTPS in production
2. Set up proper authentication and authorization
3. Regularly update dependencies
4. Implement rate limiting
5. Use secure headers
6. Consider adding a Web Application Firewall (WAF)