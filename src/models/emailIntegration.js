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
    account_id: varchar('account_id', { length: 255 }),
    is_active: boolean('is_active').default(true).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_email_integrations_user_id').on(table.user_id),
    index('idx_email_integrations_provider').on(table.provider),
  ]
);

export default email_integrations;