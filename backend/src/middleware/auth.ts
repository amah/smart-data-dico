import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// Interface for user roles
export enum UserRole {
  ADMIN = 'admin',
  EDITOR = 'editor',
  VIEWER = 'viewer'
}

// Interface for user information
export interface User {
  id: string;
  username: string;
  role: UserRole;
}

/**
 * Mock user database - in a real application, this would be stored in a database
 * and passwords would be hashed
 */
const users: Record<string, { password: string; user: User }> = {
  'admin': {
    password: 'admin123',
    user: {
      id: '1',
      username: 'admin',
      role: UserRole.ADMIN
    }
  },
  'editor': {
    password: 'editor123',
    user: {
      id: '2',
      username: 'editor',
      role: UserRole.EDITOR
    }
  },
  'viewer': {
    password: 'viewer123',
    user: {
      id: '3',
      username: 'viewer',
      role: UserRole.VIEWER
    }
  }
};

/**
 * Basic authentication middleware
 * Extracts credentials from Authorization header and validates them
 * @param req Express request
 * @param res Express response
 * @param next Next function
 */
export const basicAuth = (req: Request, res: Response, next: NextFunction) => {
  // Get authorization header
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ 
      message: 'Authentication required',
      error: 'Missing or invalid Authorization header'
    });
  }
  
  // Extract and decode credentials
  try {
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [username, password] = credentials.split(':');
    
    // Validate credentials
    const userRecord = users[username];
    
    if (!userRecord || userRecord.password !== password) {
      return res.status(401).json({ 
        message: 'Authentication failed',
        error: 'Invalid username or password'
      });
    }
    
    // Add user to request object
    (req as any).user = userRecord.user;
    
    next();
  } catch (error) {
    logger.error(`Authentication error: ${error}`);
    return res.status(401).json({ 
      message: 'Authentication failed',
      error: 'Invalid credentials format'
    });
  }
};

/**
 * Role-based authorization middleware
 * Checks if the authenticated user has one of the required roles
 * @param allowedRoles Array of allowed roles
 * @returns Middleware function
 */
export const authenticate = (allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // First apply basic authentication
    basicAuth(req, res, (err) => {
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