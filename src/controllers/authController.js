import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/drizzle.js';
import { users } from '../models/user.js';
import { eq, sql } from 'drizzle-orm';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const generateToken = (user) => {
  const secret = process.env.JWT_SECRET || 'supersecret_jwt_key_ai_automation_sas_2026';
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    secret,
    { expiresIn }
  );
};

export const register = async (req, res, next) => {
  try {
    const { name, email, password, role = 'user', avatar_url = null } = req.body;
    const db = getDb();

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Name is required.' });
    }

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
    }

    // Check existing email
    const [existingUser] = await db
      .select()
      .from(users)
      .where(sql`LOWER(${users.email}) = LOWER(${email.trim()})`);

    if (existingUser) {
      return res.status(409).json({ success: false, error: 'An account with this email address already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const [newUser] = await db
      .insert(users)
      .values({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password_hash,
        role: ['user', 'admin'].includes(role) ? role : 'user',
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

    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      message: 'Account registered successfully.',
      token,
      user: newUser,
    });
  } catch (err) {
    next(err);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const db = getDb();

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Please provide both email and password.' });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(sql`LOWER(${users.email}) = LOWER(${email.trim()})`);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password credentials.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, error: 'Your account has been deactivated.' });
    }

    if (!user.password_hash) {
      return res.status(401).json({ success: false, error: 'No password set for this account.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password credentials.' });
    }

    const userSafe = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar_url: user.avatar_url,
      is_active: user.is_active,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };

    const token = generateToken(userSafe);

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      user: userSafe,
    });
  } catch (err) {
    next(err);
  }
};

export const getMe = async (req, res, next) => {
  try {
    return res.status(200).json({
      success: true,
      user: req.user,
    });
  } catch (err) {
    next(err);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const { name, avatar_url } = req.body;
    const db = getDb();

    const updateData = { updated_at: new Date() };
    if (name && typeof name === 'string' && name.trim().length > 0) {
      updateData.name = name.trim();
    }
    if (avatar_url !== undefined) {
      updateData.avatar_url = avatar_url;
    }

    const [updatedUser] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, req.user.id))
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
      message: 'Profile updated successfully.',
      user: updatedUser,
    });
  } catch (err) {
    next(err);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const db = getDb();

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current password and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters long.' });
    }

    const [user] = await db
      .select({ password_hash: users.password_hash })
      .from(users)
      .where(eq(users.id, req.user.id));

    if (!user || !user.password_hash) {
      return res.status(400).json({ success: false, error: 'User password not found.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Current password does not match.' });
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    await db
      .update(users)
      .set({ password_hash: newHash, updated_at: new Date() })
      .where(eq(users.id, req.user.id));

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully.',
    });
  } catch (err) {
    next(err);
  }
};

export default {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
};
