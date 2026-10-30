import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { pipelineConcurrency } from '../core/config.ts';
import type { Context } from '../core/context.ts';
import { PROCESSING_DEFAULTS } from '../core/defaults.ts';
import { requireAuth } from '../core/errors.ts';
import { type ProcessingState, processingCounts, processingEntries } from './queue.ts';

// The processing page's one read. Counts for every state and the rows of one, so the page draws
// its tiles and the list under the chosen tile from one request per poll.

const PROCESSING_SDL = parse(`
  "Where a document stands in the pipeline."
  enum ProcessingState {
    "A step is running on it now."
    RUNNING
    "Waiting for a free slot."
    QUEUED
    "A step failed, and it waits for a retry."
    FAILED
    "Done, within the last \`finishedWithinHours\`."
    FINISHED
  }

  type ProcessingCounts {
    running: Int!
    queued: Int!
    failed: Int!
    finished: Int!
  }

  type ProcessingEntry {
    "A plain row: its relation fields are not loaded."
    document: Document!
    "Every step of its run, in pipeline order. Plain rows too."
    steps: [ProcessingStep!]!
    "When its last step ended."
    finishedAt: DateTime
  }

  type Processing {
    counts: ProcessingCounts!
    """
    The caller's documents in one state: running and queued oldest first, in the order the
    pipeline takes them; failed and finished newest first. At most \`listLimit\`.
    """
    entries(state: ProcessingState!): [ProcessingEntry!]!
    "How many documents the server processes at once (OCR_CONCURRENCY)."
    concurrency: Int!
    "How far back FINISHED looks, in hours."
    finishedWithinHours: Int!
    "The most rows \`entries\` returns."
    listLimit: Int!
  }

  extend type Query {
    "What the pipeline is doing with the caller's documents."
    processing: Processing!
  }
`);

/** Who is asking and the one clock every field of the answer reads. */
interface ProcessingParent {
  userId: string;
  now: Date;
}

/**
 * Adds the processing page's read to the schema.
 *
 * @param schema - The generated schema.
 * @returns The extended schema.
 */
export function applyProcessingExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, PROCESSING_SDL);
  const queries = assertObjectType(extended.getType('Query')).getFields();
  const processing = assertObjectType(extended.getType('Processing')).getFields();

  queries.processing.resolve = (_parent: unknown, _args: unknown, context: Context): ProcessingParent => ({
    userId: requireAuth(context),
    now: new Date(),
  });
  processing.counts.resolve = (parent: ProcessingParent, _args: unknown, context: Context) =>
    processingCounts(context.db, parent.userId, parent.now);
  processing.entries.resolve = (parent: ProcessingParent, args: { state: ProcessingState }, context: Context) =>
    processingEntries(context.db, parent.userId, args.state, parent.now);
  processing.concurrency.resolve = () => pipelineConcurrency();
  processing.finishedWithinHours.resolve = () => PROCESSING_DEFAULTS.finishedWithinHours;
  processing.listLimit.resolve = () => PROCESSING_DEFAULTS.listLimit;

  return extended;
}
