import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './user.js';

export const email_integrations = pgTable(
  'email_integrations',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 50 }).default('unipile').notNull(),
    api_key: text('api_key').notNull(),
    webhook_url: text('webhook_url'),
    webhook_token: varchar('webhook_token', { length: 255 }).unique(),
    account_id: varchar('account_id', { length: 255 }),
    ai_prompt: text('ai_prompt'),
    is_active: boolean('is_active').default(true).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_email_integrations_user_id').on(table.user_id),
    index('idx_email_integrations_provider').on(table.provider),
    index('idx_email_integrations_webhook_token').on(table.webhook_token),
    index('idx_email_integrations_account_id').on(table.account_id),
  ]
);

export const inbound_emails = pgTable(
  'inbound_emails',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    account_id: varchar('account_id', { length: 255 }),
    message_id: varchar('message_id', { length: 255 }),
    from_email: varchar('from_email', { length: 255 }),
    from_name: varchar('from_name', { length: 255 }),
    to_email: varchar('to_email', { length: 255 }),
    subject: text('subject'),
    snippet: text('snippet'),
    body: text('body'),
    reply_status: varchar('reply_status', { length: 50 }).default('received'),
    reply_text: text('reply_text'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_inbound_emails_user_id').on(table.user_id),
    index('idx_inbound_emails_account_id').on(table.account_id),
    index('idx_inbound_emails_created_at').on(table.created_at),
  ]
);

export default email_integrations;