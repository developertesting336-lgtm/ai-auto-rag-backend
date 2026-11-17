import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { users } from './user.js';
import { ai_models } from './aiModel.js';

export const email_campaigns = pgTable(
  'email_campaigns',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    webhook_token: varchar('webhook_token', { length: 255 }).unique().notNull(),
    unipile_api_key_encrypted: text('unipile_api_key_encrypted'),
    unipile_key_hint: varchar('unipile_key_hint', { length: 50 }),
    unipile_account_id: varchar('unipile_account_id', { length: 255 }),
    unipile_dsn: varchar('unipile_dsn', { length: 255 }),
    ai_model_id: uuid('ai_model_id').references(() => ai_models.id, { onDelete: 'set null' }),
    ai_model_name: varchar('ai_model_name', { length: 150 }),
    ai_provider: varchar('ai_provider', { length: 50 }),
    ai_prompt: text('ai_prompt').notNull(),
    status: varchar('status', { length: 50 }).default('active').notNull(), // 'active', 'paused', 'draft'
    total_received: integer('total_received').default(0).notNull(),
    total_replied: integer('total_replied').default(0).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_email_campaigns_user_id').on(table.user_id),
    index('idx_email_campaigns_webhook_token').on(table.webhook_token),
    index('idx_email_campaigns_status').on(table.status),
  ]
);

export const campaign_email_logs = pgTable(
  'campaign_email_logs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    campaign_id: uuid('campaign_id')
      .notNull()
      .references(() => email_campaigns.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    message_id: varchar('message_id', { length: 255 }),
    account_id: varchar('account_id', { length: 255 }),
    from_email: varchar('from_email', { length: 255 }),
    from_name: varchar('from_name', { length: 255 }),
    to_email: varchar('to_email', { length: 255 }),
    subject: text('subject'),
    snippet: text('snippet'),
    body: text('body'),
    reply_status: varchar('reply_status', { length: 50 }).default('received'), // 'received', 'replied', 'skipped', 'failed'
    ai_generated_reply: text('ai_generated_reply'),
    ai_model_used: varchar('ai_model_used', { length: 150 }),
    error_message: text('error_message'),
    raw_payload: jsonb('raw_payload'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_campaign_email_logs_campaign_id').on(table.campaign_id),
    index('idx_campaign_email_logs_user_id').on(table.user_id),
    index('idx_campaign_email_logs_created_at').on(table.created_at.desc()),
  ]
);

export default {
  email_campaigns,
  campaign_email_logs,
};
