import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  numeric,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './user.js';

export const ai_models = pgTable(
  'ai_models',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    provider: varchar('provider', { length: 50 }).notNull(), // 'gemini', 'openai', 'anthropic', 'groq', 'deepseek', 'mistral', 'custom'
    model_name: varchar('model_name', { length: 150 }).notNull(), // e.g. 'gemini-3.8-flash', 'gpt-4o'
    api_key_encrypted: text('api_key_encrypted').notNull(),
    key_hint: varchar('key_hint', { length: 50 }).notNull(),
    base_url: varchar('base_url', { length: 255 }),
    temperature: numeric('temperature').default('0.7'),
    max_tokens: integer('max_tokens').default(2048),
    is_active: boolean('is_active').default(true).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_ai_models_user_id').on(table.user_id),
    index('idx_ai_models_provider').on(table.provider),
  ]
);

export default ai_models;
