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

export const api_keys = pgTable(
  'api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 50 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    key_hint: varchar('key_hint', { length: 50 }).notNull(),
    encrypted_key: text('encrypted_key').notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_api_keys_user_id').on(table.user_id),
    index('idx_api_keys_provider').on(table.provider),
  ]
);

export default api_keys;
