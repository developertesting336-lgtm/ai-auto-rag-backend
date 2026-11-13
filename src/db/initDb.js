import { query, pool } from '../config/db.js';
import { fileURLToPath } from 'url';

/**
 * Initializes and synchronizes database schema directly in Aiven PostgreSQL
 */
export const initDb = async () => {
  if (!pool) {
    console.log('[Database] Skipping auto-migration: Database pool not initialized.');
    return;
  }

  try {
    console.log('🔄 [Database] Connecting and pushing schema to Aiven PostgreSQL...');

    // Extensions
    try {
      await query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
      await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    } catch (extErr) {
      // extensions check
    }

    // 1. Users Table
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        role VARCHAR(50) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'moderator')),
        avatar_url TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure columns in case table was pre-existing
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'user';`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;`);

    await query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, is_active);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);`);

    // 2. API Keys Table
    await query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        key_hint VARCHAR(50) NOT NULL,
        encrypted_key TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider);`);

    // 3. Companies Table
    await query(`
      CREATE TABLE IF NOT EXISTS companies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        industry VARCHAR(100),
        website VARCHAR(255),
        api_key VARCHAR(255) UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS api_key VARCHAR(255);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_companies_user_id ON companies(user_id);`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_api_key ON companies(api_key);`);

    // 4. Company Policies / Knowledge Base Documents Table
    await query(`
      CREATE TABLE IF NOT EXISTS company_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_size VARCHAR(50),
        r2_url TEXT,
        r2_key TEXT,
        chunk_count INTEGER DEFAULT 0,
        pinecone_file_id VARCHAR(255),
        status VARCHAR(50) NOT NULL DEFAULT 'uploaded',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await query(`ALTER TABLE company_policies ADD COLUMN IF NOT EXISTS r2_url TEXT;`);
    await query(`ALTER TABLE company_policies ADD COLUMN IF NOT EXISTS r2_key TEXT;`);
    await query(`ALTER TABLE company_policies ADD COLUMN IF NOT EXISTS chunk_count INTEGER DEFAULT 0;`);
    await query(`CREATE INDEX IF NOT EXISTS idx_company_policies_company_id ON company_policies(company_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_company_policies_user_id ON company_policies(user_id);`);

    // 5. Email / Unipile Integrations Table
    await query(`
      CREATE TABLE IF NOT EXISTS email_integrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR(50) NOT NULL DEFAULT 'unipile',
        api_key TEXT NOT NULL,
        webhook_url TEXT,
        account_id VARCHAR(255),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await query(`ALTER TABLE email_integrations ADD COLUMN IF NOT EXISTS webhook_token VARCHAR(255);`);
    await query(`ALTER TABLE email_integrations ADD COLUMN IF NOT EXISTS ai_prompt TEXT;`);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_integrations_user_id ON email_integrations(user_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_integrations_provider ON email_integrations(provider);`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_email_integrations_webhook_token ON email_integrations(webhook_token);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_email_integrations_account_id ON email_integrations(account_id);`);

    // 5b. Inbound Received Emails Table (Unipile Webhook Events)
    await query(`
      CREATE TABLE IF NOT EXISTS inbound_emails (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id VARCHAR(255),
        message_id VARCHAR(255),
        from_email VARCHAR(255),
        from_name VARCHAR(255),
        to_email VARCHAR(255),
        subject TEXT,
        snippet TEXT,
        body TEXT,
        reply_status VARCHAR(50) DEFAULT 'received',
        reply_text TEXT,
        raw_payload JSONB,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_inbound_emails_user_id ON inbound_emails(user_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_inbound_emails_account_id ON inbound_emails(account_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_inbound_emails_created_at ON inbound_emails(created_at DESC);`);

    // 6. Chatbot Client API Keys Table (Used by users for websites and widgets)
    await query(`
      CREATE TABLE IF NOT EXISTS chatbot_api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        api_key VARCHAR(255) UNIQUE NOT NULL,
        key_hint VARCHAR(50) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        last_used_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_chatbot_api_keys_company_id ON chatbot_api_keys(company_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_chatbot_api_keys_user_id ON chatbot_api_keys(user_id);`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_chatbot_api_keys_key ON chatbot_api_keys(api_key);`);

    // 7. Trigger function for updated_at
    await query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
      END;
      $$ LANGUAGE 'plpgsql';
    `);

    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_users_updated_at'
        ) THEN
          CREATE TRIGGER trigger_users_updated_at
            BEFORE UPDATE ON users
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END
      $$;
    `);

    // Fetch and print existing tables in database
    const tablesRes = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    const tableNames = tablesRes.rows.map(r => r.table_name).join(', ');

    console.log(`\x1b[32m✔ Schema push complete! Verified tables in Aiven:\x1b[0m [ ${tableNames} ]`);
  } catch (err) {
    console.error('\x1b[31m✖ Schema push failed:\x1b[0m', err.message);
    throw err;
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  initDb()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export default initDb;
