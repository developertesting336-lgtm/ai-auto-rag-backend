
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: 'd:/divyanshu/AI Automation SAS/backend/.env' });

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { Client } = pg;
const directUrl = (process.env.DB_URL || process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&#]*/g, '');

async function checkMax() {
  const client = new Client({
    connectionString: directUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    const maxRes = await client.query('SHOW max_connections');
    console.log('max_connections:', maxRes.rows[0].max_connections);

    const supRes = await client.query('SHOW superuser_reserved_connections');
    console.log('superuser_reserved_connections:', supRes.rows[0].superuser_reserved_connections);

    // Terminate all idle avnadmin connections from older sessions
    const term = await client.query(`
      SELECT pg_terminate_backend(pid), pid
      FROM pg_stat_activity 
      WHERE pid <> pg_backend_pid() 
        AND usename = 'avnadmin'
        AND state = 'idle'
    `);
    console.log('Terminated idle avnadmin backends:', term.rowCount);

    const finalCount = await client.query('SELECT count(*) FROM pg_stat_activity WHERE usename = "avnadmin"');
    console.log('Active avnadmin backends now:', finalCount.rows[0].count);

    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkMax();
