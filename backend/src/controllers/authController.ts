import { Request, Response } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { User, UserRole } from '../middleware/auth';

// Mock user database - imported from auth middleware
// In a real application, this would be in a separate database module
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

// JWT secret key - should be in environment variables in production
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
// Token expiration time (default: 24 hours)
const TOKEN_EXPIRATION = process.env.TOKEN_EXPIRATION || '24h';

/**
 * Login controller
 * Validates username and password, generates JWT token
 * @param req Express request
 * @param res Express response
 */
export const login = (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    // Validate request body
    if (!username || !password) {
      return res.status(400).json({
        message: 'Bad request',
        error: 'Username and password are required'
      });
    }

    // Validate credentials
    const userRecord = users[username];
    
    if (!userRecord || userRecord.password !== password) {
      logger.info(`Failed login attempt for user: ${username}`);
      return res.status(401).json({
        message: 'Authentication failed',
        error: 'Invalid username or password'
      });
    }

    // Generate JWT token
    const payload = {
      id: userRecord.user.id,
      username: userRecord.user.username,
      role: userRecord.user.role
    };
    const options: SignOptions = { expiresIn: TOKEN_EXPIRATION as any };
    const token = jwt.sign(payload, JWT_SECRET, options);

    logger.info(`User logged in: ${username}`);
    
    // Return token and user info
    return res.status(200).json({
      message: 'Authentication successful',
      token,
      user: {
        id: userRecord.user.id,
        username: userRecord.user.username,
        role: userRecord.user.role
      }
    });
  } catch (error: any) {
    logger.error(`Login error: ${error.message}`);
    return res.status(500).json({
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
};

/**
 * Get current user controller
 * Returns user information based on JWT token
 * @param req Express request
 * @param res Express response
 */
export const getCurrentUser = (req: Request, res: Response) => {
  try {
    // User should be attached to request by JWT middleware
    const user = (req as any).user;
    
    if (!user) {
      return res.status(401).json({
        message: 'Authentication required',
        error: 'User not authenticated'
      });
    }
    
    return res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error: any) {
    logger.error(`Get current user error: ${error.message}`);
    return res.status(500).json({
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  }
};