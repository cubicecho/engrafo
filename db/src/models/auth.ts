import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

// better-auth's tables. Its models are `user`, `session`, `account` and
// `verification`; `server/src/auth/better-auth.ts` maps them onto these by key,
// so the property names below are the ones better-auth reads and must not be
// renamed. None of them is in the GraphQL schema (`build-schema.ts` excludes
// them): sessions and magic-link tokens are only ever touched through
// better-auth.

/**
 * Sessions, when `SESSION_STORE=database`. With the in-memory default the table
 * stays empty, and exists so that switching stores needs no migration.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('uq_sessions_token').on(table.token), index('idx_sessions_user_id').on(table.userId)],
);

/** How a user signs in: one row per provider. Empty until a provider beyond magic links is added. */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_accounts_provider_id_account_id').on(table.providerId, table.accountId),
    index('idx_accounts_user_id').on(table.userId),
  ],
);

/** Magic-link tokens, stored hashed and deleted when used. */
export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_verifications_identifier').on(table.identifier)],
);

/**
 * API keys, as better-auth's api-key plugin stores them: what an MCP client sends instead of a
 * session, which expires and lives in memory by default. Only the key's hash is kept.
 */
export const apikeys = pgTable(
  'apikeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Which plugin configuration minted the key. Engrafo has one. */
    configId: text('config_id').notNull().default('default'),
    name: text('name'),
    /** The key's first characters, shown so a user can tell keys apart. */
    start: text('start'),
    prefix: text('prefix'),
    /** The key's hash. */
    key: text('key').notNull(),
    /** The user the key acts as. */
    referenceId: uuid('reference_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refillInterval: integer('refill_interval'),
    refillAmount: integer('refill_amount'),
    lastRefillAt: timestamp('last_refill_at', { withTimezone: true }),
    enabled: boolean('enabled').notNull().default(true),
    rateLimitEnabled: boolean('rate_limit_enabled').notNull().default(true),
    rateLimitTimeWindow: integer('rate_limit_time_window'),
    rateLimitMax: integer('rate_limit_max'),
    requestCount: integer('request_count').notNull().default(0),
    /** Uses left, or null for no cap. */
    remaining: integer('remaining'),
    lastRequest: timestamp('last_request', { withTimezone: true }),
    /** null for a key that never expires. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    permissions: text('permissions'),
    /** JSON the plugin serializes itself. */
    metadata: text('metadata'),
  },
  (table) => [
    index('idx_apikeys_reference_id').on(table.referenceId),
    index('idx_apikeys_key').on(table.key),
    index('idx_apikeys_config_id').on(table.configId),
  ],
);

/** An API key row as read. */
export type ApiKey = typeof apikeys.$inferSelect;

/** The Drizzle keys of every table above, which the GraphQL schema leaves out. */
export const AUTH_TABLES = ['sessions', 'accounts', 'verifications', 'apikeys'] as const;
