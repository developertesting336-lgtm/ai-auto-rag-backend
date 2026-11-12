import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

let pool = null;

/**
 * Strips sslmode query parameters from connection URL so pg-connection-string
 * does not override rejectUnauthorized: false with strict verify-full mode.
 */
function cleanConnectionUrl(urlStr) {
  if (!urlStr) return '';
  try {
    const parsed = new URL(urlStr);
    parsed.searchParams.delete('sslmode');
    parsed.searchParams.delete('uselibpqcompat');
    return parsed.toString();
  } catch {
    return urlStr
      .replace(/[?&]sslmode=[^&#]*/g, '')
      .replace(/\?&/, '?')
      .replace(/[?&]$/, '');
  }
}

if (Pool) {
  const rawConnectionString = process.env.DB_URL || process.env.DATABASE_URL || '';

  // Aiven & cloud PostgreSQL require SSL
  const isSslRequired = Boolean(
    process.env.DB_SSL === 'true' ||
    rawConnectionString.includes('aivencloud.com') ||
    rawConnectionString.includes('sslmode=')
  );

  // Disable Node TLS rejection for cloud providers using self-signed CA certs
  if (isSslRequired) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const cleanConnectionString = cleanConnectionUrl(rawConnectionString);

  const connectionConfig = cleanConnectionString
    ? {
        connectionString: cleanConnectionString,
        ssl: isSslRequired ? { rejectUnauthorized: false } : false,
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'defaultdb',
        ssl: isSslRequired ? { rejectUnauthorized: false } : false,
      };

  pool = new Pool(connectionConfig);

  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err.message);
  });
}

/**
 * Executes a SQL query using the connection pool
 * @param {string} text - SQL statement
 * @param {Array} params - Parameterized query values
 */
export const query = async (text, params) => {
  if (!pool) {
    throw new Error('Database pool is not initialized. Please ensure "pg" is installed ("npm install").');
  }
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    console.log('[DB Query]', { text: text.trim().split('\n')[0], duration: `${duration}ms`, rows: res.rowCount });
  }
  return res;
};

/**
 * Tests connection to the PostgreSQL database
 */
export const testConnection = async () => {
  if (!pool) {
    return { success: false, message: '"pg" module is not installed. Run "npm install".' };
  }
  try {
    const res = await pool.query('SELECT NOW() as current_time, current_database() as database, version() as version');
    return {
      success: true,
      message: 'Connected to Aiven PostgreSQL database successfully',
      data: res.rows[0],
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to connect to PostgreSQL: ${err.message}`,
    };
  }
};

export { pool };
export default { pool, query, testConnection };
