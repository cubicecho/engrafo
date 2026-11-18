import type { DB } from '@cubicecho/engrafo-db';
import { type Document, documents, type MergeSuggestion } from '@cubicecho/engrafo-db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import type { Context } from '../core/context.ts';
import { MERGE_SUGGESTION_DEFAULTS } from '../core/defaults.ts';
import { notFound, requireAuth } from '../core/errors.ts';
import { notTrashed } from '../trash/trash.ts';
import { confidenceBand } from './score.ts';
import { countOpenSuggestions, dismissSuggestion, loadOpenSuggestions } from './store.ts';

// The suggested merges, as the person reads and answers them. Hand-written rather than generated:
// a row is shown only while every member is still the caller's, ready and out of the trash
// (`membersAreLive`) and the model has not ruled it out (`isShown`), and a generated read can
// apply neither, so `merge_suggestions` is out of the generated schema and every read here goes
// through `loadOpenSuggestions` or `countOpenSuggestions`, which apply both.

const MERGE_SUGGESTIONS_SDL = parse(`
  "How sure a suggestion is, as the page shows it."
  enum MergeSuggestionBand {
    HIGH
    MEDIUM
    LOW
  }

  "One thing that moved a suggestion's confidence."
  type MergeSuggestionReason {
    "Which signal: \`time\`, \`sequence\`, \`pageMarker\`, … or \`ai\` for the model's answer."
    signal: String!
    "For the person deciding: \`scanned 40 s apart\`, \`AI: page 2 continues page 1 (…)\`."
    text: String!
    "What it added to its step. Negative when it counted against."
    points: Float!
  }

  "What the vision model answered about one break between two pages of a suggestion."
  type MergeSuggestionVerdict {
    fromId: UUID!
    toId: UUID!
    "Whether the model says \`toId\` continues \`fromId\`."
    continues: Boolean!
    "How sure the model was, 0 to 1."
    confidence: Float!
    "Why, in its words."
    reason: String!
    "The model that answered."
    model: String!
    checkedAt: DateTime!
  }

  "A set of the caller's documents that looks like one scan filed as several."
  type MergeSuggestion {
    id: UUID!
    """
    The members, in the order their pages would go in. Plain rows: relation fields such as
    \`folder\` are not loaded; use \`folderId\`.
    """
    documents: [Document!]!
    "How sure, 0 to 1: the weakest break between two pages, once the model has moved it."
    confidence: Float!
    "How sure the rules alone are, 0 to 1. The same as \`confidence\` when the model did not check it."
    heuristicConfidence: Float!
    band: MergeSuggestionBand!
    "Every signal that moved it, the model's included, the strongest for first and the strongest against last."
    reasons: [MergeSuggestionReason!]!
    "The model's answers, one per break it was asked about. Empty when it checked none."
    verdicts: [MergeSuggestionVerdict!]!
    createdAt: DateTime!
  }

  type MergeSuggestions {
    """
    The caller's suggested merges, the surest first. Only those whose documents are all still
    there to merge, and that the model has not ruled out. With \`documentId\`, only those it is in.
    """
    suggestions(documentId: UUID): [MergeSuggestion!]!
    "How many \`suggestions\` holds, for the sidebar's badge."
    count: Int!
  }

  extend type Query {
    mergeSuggestions: MergeSuggestions!
  }

  extend type Mutation {
    """
    Says the documents of a suggestion are not to be merged, so the same set is never suggested
    again. True for one already dismissed; NOT_FOUND for anything else that is not the caller's
    open suggestion.
    """
    dismissMergeSuggestion(id: UUID!): Boolean!
    """
    Scores the caller's recent documents again now, and has the model check what the rules are
    unsure of, rather than waiting for the next document to finish. Waits for the run, and joins
    one already running instead of starting a second.
    """
    rescoreMergeSuggestions: MergeSuggestions!
  }
`);

/** The scorer's bands as the enum names them. */
const BAND_NAMES = { high: 'HIGH', medium: 'MEDIUM', low: 'LOW' } as const;

/** The parent the `MergeSuggestions` fields resolve from: only who is asking. */
interface MergeSuggestionsParent {
  userId: string;
}

/** A suggestion as the API answers it. */
interface MergeSuggestionView extends Pick<MergeSuggestion, 'id' | 'confidence' | 'heuristicConfidence' | 'reasons'> {
  documents: Document[];
  band: 'HIGH' | 'MEDIUM' | 'LOW';
  verdicts: Array<Omit<MergeSuggestion['aiVerdicts'][number], 'checkedAt'> & { checkedAt: Date }>;
  createdAt: Date;
}

/**
 * The suggestions with their documents, read in one query for all of them.
 *
 * @param db - The connection.
 * @param userId - The caller; the documents read are theirs and out of the trash.
 * @param rows - Shown suggestions, as `loadOpenSuggestions` returns them.
 * @returns Each with its members in page order. One that lost a member between the two reads is
 *   left out, as the next read would leave it out.
 */
async function withDocuments(db: DB, userId: string, rows: readonly MergeSuggestion[]): Promise<MergeSuggestionView[]> {
  const ids = [...new Set(rows.flatMap((row) => row.documentIds))];
  if (ids.length === 0) {
    return [];
  }
  const members = await db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, userId), inArray(documents.id, ids), notTrashed()));
  const byId = new Map(members.map((doc) => [doc.id, doc]));
  return rows.flatMap((row) => {
    const docs = row.documentIds.flatMap((id) => byId.get(id) ?? []);
    if (docs.length !== row.documentIds.length) {
      return [];
    }
    return [
      {
        id: row.id,
        documents: docs,
        confidence: row.confidence,
        heuristicConfidence: row.heuristicConfidence,
        band: BAND_NAMES[confidenceBand(row.confidence, MERGE_SUGGESTION_DEFAULTS)],
        reasons: row.reasons,
        verdicts: row.aiVerdicts.map((verdict) => ({ ...verdict, checkedAt: new Date(verdict.checkedAt) })),
        createdAt: row.createdAt,
      },
    ];
  });
}

function suggestionNotFound() {
  return notFound('Suggestion not found');
}

/**
 * Adds the suggested merges' reads, `dismissMergeSuggestion` and `rescoreMergeSuggestions`.
 *
 * @param schema - The schema, which must already have a Mutation type.
 * @returns The extended schema.
 */
export function applyMergeSuggestionsExtension(schema: GraphQLSchema): GraphQLSchema {
  const extended = extendSchema(schema, MERGE_SUGGESTIONS_SDL);
  const queries = assertObjectType(extended.getType('Query')).getFields();
  const mutations = assertObjectType(extended.getType('Mutation')).getFields();
  const suggestions = assertObjectType(extended.getType('MergeSuggestions')).getFields();

  queries.mergeSuggestions.resolve = (_parent: unknown, _args: unknown, context: Context): MergeSuggestionsParent => ({
    userId: requireAuth(context),
  });
  suggestions.suggestions.resolve = async (
    parent: MergeSuggestionsParent,
    args: { documentId?: string | null },
    context: Context,
  ) => {
    const rows = await loadOpenSuggestions(context.db, parent.userId, { documentId: args.documentId ?? undefined });
    return withDocuments(context.db, parent.userId, rows);
  };
  // The sidebar refetches this for its badge, so it does not drag every row along.
  suggestions.count.resolve = (parent: MergeSuggestionsParent, _args: unknown, context: Context) =>
    countOpenSuggestions(context.db, parent.userId);

  mutations.dismissMergeSuggestion.resolve = async (_parent: unknown, args: { id: string }, context: Context) => {
    const userId = requireAuth(context);
    if (z.uuid().safeParse(args.id).success === false) {
      throw suggestionNotFound();
    }
    const dismissal = await dismissSuggestion(context.db, userId, args.id);
    if (dismissal.status === 'missing') {
      throw suggestionNotFound();
    }
    if (dismissal.status === 'dismissed') {
      // With its scores, so the weights can be tuned against what people turned down.
      const { confidence, heuristicConfidence } = dismissal.scores;
      console.log(
        `[merge-suggestions] ${userId}: dismissed ${args.id} at ${percent(confidence)} (rules ${percent(heuristicConfidence)})`,
      );
    }
    return true;
  };

  mutations.rescoreMergeSuggestions.resolve = async (
    _parent: unknown,
    _args: unknown,
    context: Context,
  ): Promise<MergeSuggestionsParent> => {
    const userId = requireAuth(context);
    await context.mergeSuggester.rescoreNow(userId);
    return { userId };
  };

  return extended;
}

/** A confidence (0–1) as the log line says it. */
function percent(confidence: number): string {
  const PERCENT = 100;
  return `${Math.round(confidence * PERCENT)}%`;
}
