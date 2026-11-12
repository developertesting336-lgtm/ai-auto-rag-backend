import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).unique().notNull(),
    password_hash: varchar('password_hash', { length: 255 }),
    role: varchar('role', { length: 50 }).default('user').notNull(),
    avatar_url: text('avatar_url'),
    is_active: boolean('is_active').default(true).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_users_email').on(table.email),
    index('idx_users_role_status').on(table.role, table.is_active),
    index('idx_users_created_at').on(table.created_at.desc()),
  ]
);

export default users;
