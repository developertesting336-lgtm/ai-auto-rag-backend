import { pool } from '../config/db.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../models/index.js';

let db = null;

export const getDb = () => {
  if (!db) {
    if (!pool) {
      throw new Error('Database connection pool is not ready. Check your .env DB_URL.');
    }
    db = drizzle(pool, { schema });
  }
  return db;
};

// Initialize if pool is already available
if (pool) {
  try {
    db = drizzle(pool, { schema });
  } catch (err) {
    // Lazy initialized on first getDb() call
  }
}

export { db, schema };
export default db;
