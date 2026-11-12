import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './user.js';
import { companies } from './company.js';

export const chatbot_api_keys = pgTable(
  'chatbot_api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    api_key: varchar('api_key', { length: 255 }).unique().notNull(),
    key_hint: varchar('key_hint', { length: 50 }).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    last_used_at: timestamp('last_used_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_chatbot_api_keys_company_id').on(table.company_id),
    index('idx_chatbot_api_keys_user_id').on(table.user_id),
    index('idx_chatbot_api_keys_key').on(table.api_key),
  ]
);

export default chatbot_api_keys;

