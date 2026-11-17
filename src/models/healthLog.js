import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './user.js';
import { ai_models } from './aiModel.js';

export const ai_model_health_logs = pgTable(
  'ai_model_health_logs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    model_id: uuid('model_id')
      .notNull()
      .references(() => ai_models.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 50 }).notNull().default('healthy'), // 'healthy', 'error'
    latency_ms: integer('latency_ms').default(0),
    error_message: text('error_message'),
    check_type: varchar('check_type', { length: 50 }).default('hourly_cron'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_health_logs_model_id').on(table.model_id),
    index('idx_health_logs_user_id').on(table.user_id),
    index('idx_health_logs_created_at').on(table.created_at),
  ]
);

export default ai_model_health_logs;
