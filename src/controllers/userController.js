import bcrypt from 'bcryptjs';
import { getDb } from '../db/drizzle.js';
import { users } from '../models/user.js';
import { eq, ilike, or, and, count, desc, sql } from 'drizzle-orm';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role = 'user', avatar_url = null } = req.body;
    const db = getDb();

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Name is required.' });
    }

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    }

    const validRoles = ['user', 'admin', 'moderator'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ success: false, error: `Invalid role. Allowed roles: ${validRoles.join(', ')}` });
    }

    // Check duplicate
    const [existingUser] = await db
      .select()
      .from(users)
      .where(sql`LOWER(${users.email}) = LOWER(${email.trim()})`);

    if (existingUser) {
      return res.status(409).json({ success: false, error: 'A user with this email address already exists.' });
    }

    let password_hash = null;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      password_hash = await bcrypt.hash(password, salt);
    }

    const [newUser] = await db
      .insert(users)
      .values({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password_hash,
        role,
        avatar_url,
      })
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        avatar_url: users.avatar_url,
        is_active: users.is_active,
        created_at: users.created_at,
        updated_at: users.updated_at,
      });

    return res.status(201).json({
      success: true,
      message: 'User created successfully.',
      data: newUser,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search = '', role = '', is_active } = req.query;
    const db = getDb();

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const offset = (parsedPage - 1) * parsedLimit;

    const conditions = [];

    if (search) {
      conditions.push(or(ilike(users.name, `%${search.trim()}%`), ilike(users.email, `%${search.trim()}%`)));
    }

    if (role) {
      conditions.push(eq(users.role, role));
    }

    if (is_active !== undefined) {
      conditions.push(eq(users.is_active, is_active === 'true' || is_active === true));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db.select({ total: count() }).from(users).where(whereClause);
    const total = Number(countResult?.total || 0);

    const rows = await db
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
      .where(whereClause)
      .limit(parsedLimit)
      .offset(offset)
      .orderBy(desc(users.created_at));

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages: Math.ceil(total / parsedLimit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();

    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID format. Expected UUID.' });
    }

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
      .where(eq(users.id, id));

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    return res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

export const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, role, avatar_url, is_active, password } = req.body;
    const db = getDb();

    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID format. Expected UUID.' });
    }

    const [existingUser] = await db.select().from(users).where(eq(users.id, id));
    if (!existingUser) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const updateData = {};

    if (name && typeof name === 'string' && name.trim().length > 0) {
      updateData.name = name.trim();
    }

    if (email !== undefined) {
      if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({ success: false, error: 'Invalid email address format.' });
      }
      if (email.toLowerCase().trim() !== existingUser.email.toLowerCase()) {
        const [emailUser] = await db
          .select()
          .from(users)
          .where(sql`LOWER(${users.email}) = LOWER(${email.trim()})`);
        if (emailUser && emailUser.id !== id) {
          return res.status(409).json({ success: false, error: 'Email is already in use by another user.' });
        }
      }
      updateData.email = email.toLowerCase().trim();
    }

    const validRoles = ['user', 'admin', 'moderator'];
    if (role !== undefined && validRoles.includes(role)) {
      updateData.role = role;
    }

    if (avatar_url !== undefined) updateData.avatar_url = avatar_url;
    if (is_active !== undefined) updateData.is_active = is_active;

    if (password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password_hash = await bcrypt.hash(password, salt);
    }

    updateData.updated_at = new Date();

    const [updatedUser] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        avatar_url: users.avatar_url,
        is_active: users.is_active,
        created_at: users.created_at,
        updated_at: users.updated_at,
      });

    return res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      data: updatedUser,
    });
  } catch (err) {
    next(err);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();

    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID format.' });
    }

    const [deleted] = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'User deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
};

export const deactivateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();

    if (!UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID format.' });
    }

    const [updatedUser] = await db
      .update(users)
      .set({ is_active: false, updated_at: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id, is_active: users.is_active });

    if (!updatedUser) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'User deactivated successfully.',
      data: updatedUser,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  deactivateUser,
};
