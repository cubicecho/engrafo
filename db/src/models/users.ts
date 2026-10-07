import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * One row per person. better-auth writes it as its `user` model, so the property names are the
 * ones it reads and must not be renamed.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name'),
    // better-auth's. Following a magic link is what proves the address.
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('uq_users_email').on(table.email)],
);

/** A user row as read. */
export type User = typeof users.$inferSelect;
/** A user row as inserted. */
export type NewUser = typeof users.$inferInsert;
