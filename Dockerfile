# Stage 1: Build frontend
FROM node:18-alpine AS build-frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM node:18-alpine AS build-backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY backend/ ./
RUN npm run build

# Stage 3: Runtime
FROM node:18-alpine
WORKDIR /app

# Install production deps only
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy built backend
COPY --from=build-backend /app/backend/dist ./dist

# Copy built frontend into public/ for static serving
COPY --from=build-frontend /app/frontend/dist ./public

# Copy default data dictionaries
COPY data-dictionaries ./data-dictionaries

# Environment
ENV NODE_ENV=production
ENV PORT=3001
ENV PROFILE=team
ENV GIT_AUTO_COMMIT=true

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3001/api/status || exit 1

CMD ["node", "dist/server.js"]
