import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Prevent Node TLS from rejecting Aiven's self-signed CA certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const rawUrl = process.env.DB_URL || process.env.DATABASE_URL || '';

let dbCredentials;
try {
  const parsed = new URL(rawUrl);
  dbCredentials = {
    host: parsed.hostname,
    port: parseInt(parsed.port || '5432', 10),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, '') || 'defaultdb',
    ssl: { rejectUnauthorized: false },
  };
} catch {
  dbCredentials = {
    url: rawUrl,
    ssl: { rejectUnauthorized: false },
  };
}

export default defineConfig({
  schema: './src/models/index.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials,
});
