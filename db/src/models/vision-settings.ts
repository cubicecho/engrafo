import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The vision model that re-reads scanned pages (server/src/vision/): one row or none, the
 * instance's, set by the admin in Settings and read by the pipeline at the start of every run, so
 * a change takes effect on the next document without a restart. The API key is a credential and
 * nothing reads it back out through the API, which is why the table is not in the GraphQL schema.
 */
export const visionSettings = pgTable(
  'vision_settings',
  {
    id: text('id').primaryKey().default('vision'),
    // An OpenAI-compatible base URL: Ollama, LM Studio, vLLM, a hosted provider.
    baseUrl: text('base_url'),
    model: text('model'),
    apiKey: text('api_key'),
    // On, every document OCR runs on is re-read; off, only one asked for from its page.
    auto: boolean('auto').notNull().default(false),
    // How long one page may take. Null is VISION_DEFAULTS.requestTimeoutSeconds.
    requestTimeoutSeconds: integer('request_timeout_seconds'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [check('vision_settings_singleton', sql`${table.id} = 'vision'`)],
);

/** The settings row as read. */
export type VisionSettings = typeof visionSettings.$inferSelect;
