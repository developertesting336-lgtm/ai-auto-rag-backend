import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './user.js';

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    stripe_customer_id: varchar('stripe_customer_id', { length: 255 }),
    stripe_subscription_id: varchar('stripe_subscription_id', { length: 255 }),
    plan_id: varchar('plan_id', { length: 100 }).notNull().default('starter'),
    plan_name: varchar('plan_name', { length: 100 }).notNull().default('Starter Plan'),
    amount: integer('amount').default(1900).notNull(), // amount in cents
    currency: varchar('currency', { length: 10 }).default('usd').notNull(),
    interval: varchar('interval', { length: 20 }).default('month').notNull(),
    status: varchar('status', { length: 50 }).default('inactive').notNull(), // 'active', 'past_due', 'canceled', 'inactive'
    current_period_start: timestamp('current_period_start', { withTimezone: true }),
    current_period_end: timestamp('current_period_end', { withTimezone: true }),
    cancel_at_period_end: boolean('cancel_at_period_end').default(false).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_subscriptions_user_id').on(table.user_id),
    index('idx_subscriptions_status').on(table.status),
    index('idx_subscriptions_stripe_sub_id').on(table.stripe_subscription_id),
  ]
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    stripe_payment_intent_id: varchar('stripe_payment_intent_id', { length: 255 }),
    stripe_invoice_id: varchar('stripe_invoice_id', { length: 255 }),
    amount: integer('amount').notNull(), // amount in cents
    currency: varchar('currency', { length: 10 }).default('usd').notNull(),
    status: varchar('status', { length: 50 }).default('paid').notNull(), // 'paid', 'pending', 'failed', 'refunded'
    plan_id: varchar('plan_id', { length: 100 }),
    plan_name: varchar('plan_name', { length: 100 }),
    receipt_url: text('receipt_url'),
    invoice_pdf: text('invoice_pdf'),
    failure_reason: text('failure_reason'),
    paid_at: timestamp('paid_at', { withTimezone: true }).defaultNow(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_payments_user_id').on(table.user_id),
    index('idx_payments_created_at').on(table.created_at.desc()),
  ]
);

export default {
  subscriptions,
  payments,
};
