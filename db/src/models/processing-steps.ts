import { index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { documents } from './documents.ts';
import { users } from './users.ts';

export const stepStatus = pgEnum('step_status', ['queued', 'running', 'succeeded', 'skipped', 'failed']);

/**
 * One row per pipeline step per document. This is the whole of the pipeline's
 * state — there is no queue behind it — so it is what the UI shows, what retry
 * resets, and what a restarted server resumes from.
 */
export const processingSteps = pgTable(
  'processing_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    step: text('step').notNull(),
    // The step's index in the pipeline, so the UI can order the timeline without
    // knowing the step list.
    position: integer('position').notNull(),
    status: stepStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_processing_steps_document_step').on(t.documentId, t.step),
    index('idx_processing_steps_user_id').on(t.userId),
    index('idx_processing_steps_document_id').on(t.documentId),
  ],
);

export type ProcessingStep = typeof processingSteps.$inferSelect;
export type NewProcessingStep = typeof processingSteps.$inferInsert;
export type StepStatus = (typeof stepStatus.enumValues)[number];
