import jwt from 'jsonwebtoken';
import { getDb } from '../db/drizzle.js';
import { users } from '../models/user.js';
import { eq } from 'drizzle-orm';

/**
 * Middleware to verify JWT token and authenticate user
 */
export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. Bearer token missing.',
      });
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET || 'supersecret_jwt_key_ai_automation_sas_2026';

    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (tokenErr) {
      if (tokenErr.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: 'Token has expired. Please log in again.',
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Invalid token signature.',
      });
    }

    // Fetch user from DB using Drizzle
    const db = getDb();
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        avatar_url: users.avatar_url,
        is_active: users.is_active,
        created_at: users.created_at,
        updated_at: users.updated_at,
      })
      .from(users)
      .where(eq(users.id, decoded.id))
      .limit(1);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'The user belonging to this token no longer exists.',
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error: 'Your account has been deactivated.',
      });
    }

    // Attach user to request object
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware to restrict route access to specific roles
 * @param  {...string} roles - e.g. 'admin', 'moderator'
 */
export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: requires one of the following roles: ${roles.join(', ')}`,
      });
    }

    next();
  };
};

export default { verifyToken, requireRole };
