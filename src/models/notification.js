import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './user.js';

export const user_notifications = pgTable(
  'user_notifications',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    message: text('message').notNull(),
    type: varchar('type', { length: 50 }).default('health_alert').notNull(),
    severity: varchar('severity', { length: 50 }).default('warning').notNull(), // 'info', 'warning', 'critical'
    data: jsonb('data'),
    is_read: boolean('is_read').default(false).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_notifications_user_id').on(table.user_id),
    index('idx_notifications_created_at').on(table.created_at),
    index('idx_notifications_is_read').on(table.is_read),
  ]
);

export default user_notifications;
