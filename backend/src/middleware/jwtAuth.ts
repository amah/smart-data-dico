import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
import { User } from './auth.js';

// JWT secret key - should be in environment variables in production
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

/**
 * JWT authentication middleware
 * Verifies JWT token from Authorization header
 * @param req Express request
 * @param res Express response
 * @param next Next function
 */
export const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  // Mock token bypass for development and local profile
  const isLocalProfile = (process.env.PROFILE || 'local') === 'local';
  if ((process.env.NODE_ENV === 'development' || isLocalProfile) && req.headers.authorization === 'Bearer mock-token-for-testing') {
    // Set a mock user for development
    (req as any).user = {
      id: 'dev-user',
      username: 'developer',
      email: 'dev@example.com',
      role: 'admin'
    };
    return next();
  }

  // Get authorization header
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Authentication required',
      error: 'Missing or invalid Authorization header'
    });
  }
  
  // Extract token
  const token = authHeader.split(' ')[1];
  
  try {
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET as jwt.Secret) as User;
    
    // Add user to request object
    (req as any).user = decoded;
    
    next();
  } catch (error: any) {
    logger.error(`JWT verification error: ${error.message}`);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        message: 'Authentication failed',
        error: 'Token expired'
      });
    }
    
    return res.status(401).json({ 
      message: 'Authentication failed',
      error: 'Invalid token'
    });
  }
};

/**
 * Role-based authorization middleware using JWT
 * Checks if the authenticated user has one of the required roles
 * @param allowedRoles Array of allowed roles
 * @returns Middleware function
 */
export const authorizeJwt = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // First verify token
    verifyToken(req, res, (err) => {
      if (err) return next(err);
      
      // Check if user has required role
      const user = (req as any).user as User;
      
      if (!user) {
        return res.status(401).json({ 
          message: 'Authentication required',
          error: 'User not authenticated'
        });
      }
      
      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({ 
          message: 'Access denied',
          error: 'Insufficient permissions'
        });
      }
      
      next();
    });
  };
};