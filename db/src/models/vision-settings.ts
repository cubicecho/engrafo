import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The vision model that re-reads scanned pages (server/src/vision/): one row or none, the
 * instance's, set by the admin in Settings and read by the pipeline at the start of every run, so
 * a change takes effect on the next document without a restart. The API key is a credential and
 * nothing reads it back out through the API, which is why the table is not in the GraphQL schema.
 */
/**
 * How closely the model looks at a page, as OpenAI's image `detail` names it. `low` scales the
 * page to fit 512×512, which a local vision encoder reads in a fraction of the time and which
 * loses fine print; `high` reads it at full size; `auto` lets the server decide.
 */
export const VisionImageDetail = { Auto: 'auto', Low: 'low', High: 'high' } as const;

/** One of `VisionImageDetail`'s values. */
export type VisionImageDetail = (typeof VisionImageDetail)[keyof typeof VisionImageDetail];

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
    // The longest reply one page may get, in tokens. Null is VISION_DEFAULTS.pageMaxTokens.
    maxResponseTokens: integer('max_response_tokens'),
    // The image part's OpenAI `detail`. Null is `auto`, which sends none and leaves it to the server.
    imageDetail: text('image_detail').$type<VisionImageDetail>(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check('vision_settings_singleton', sql`${table.id} = 'vision'`),
    check('vision_settings_image_detail', sql`${table.imageDetail} in ('auto', 'low', 'high')`),
    check('vision_settings_max_response_tokens', sql`${table.maxResponseTokens} > 0`),
  ],
);

/** The settings row as read. */
export type VisionSettings = typeof visionSettings.$inferSelect;
