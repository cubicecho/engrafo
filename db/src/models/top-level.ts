import { sql } from 'drizzle-orm';

/**
 * Stands in for "no parent" inside a unique index. An index treats every NULL as
 * distinct, so without it two top-level folders could share a name. Not exported
 * from the schema: it is SQL, not a table.
 */
export const TOP_LEVEL = sql`'00000000-0000-0000-0000-000000000000'::uuid`;
