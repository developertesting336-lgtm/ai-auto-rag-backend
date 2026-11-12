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

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    industry: varchar('industry', { length: 100 }),
    website: varchar('website', { length: 255 }),
    api_key: varchar('api_key', { length: 255 }).unique(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_companies_user_id').on(table.user_id),
    index('idx_companies_api_key').on(table.api_key),
  ]
);

export const company_policies = pgTable(
  'company_policies',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    company_id: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    file_name: varchar('file_name', { length: 255 }).notNull(),
    file_size: varchar('file_size', { length: 50 }),
    r2_url: text('r2_url'),
    r2_key: text('r2_key'),
    chunk_count: integer('chunk_count').default(0),
    pinecone_file_id: varchar('pinecone_file_id', { length: 255 }),
    status: varchar('status', { length: 50 }).default('uploaded').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_company_policies_company_id').on(table.company_id),
    index('idx_company_policies_user_id').on(table.user_id),
  ]
);

export default { companies, company_policies };
