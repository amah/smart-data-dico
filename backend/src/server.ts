import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes';
import { setupSwagger } from './utils/swagger';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
// Access logging middleware
app.use((req: Request, res: Response, next) => {
  const start = process.hrtime();
  res.on('finish', () => {
    const diff = process.hrtime(start);
    const executionTimeMs = Number((diff[0] * 1e3 + diff[1] / 1e6).toFixed(2));
    logger.info('HTTP Access', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      executionTimeMs
    });
  });
  next();
});

app.use(express.json());

// Basic route
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Welcome to the Data Dictionary Management System API' });
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// API routes
app.use(routes);

// Setup Swagger documentation
setupSwagger(app);

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: any) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? undefined : err.message
  });
});

// Start server
app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
  logger.info(`API documentation available at http://localhost:${port}/api-docs`);
});

export default app;