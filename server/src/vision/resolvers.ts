import {
  type Document,
  DocumentStatus,
  documents,
  processingSteps,
  StepStatus,
  VisionImageDetail,
} from '@cubicecho/engrafo-db/schema';
import { and, eq, inArray, or } from 'drizzle-orm';
import { assertObjectType, extendSchema, type GraphQLSchema, parse } from 'graphql';
import { z } from 'zod';
import { isAdmin } from '../auth/admin.ts';
import type { Context } from '../core/context.ts';
import { VISION_DEFAULTS } from '../core/defaults.ts';
import { badInput, conflict, forbidden, requireAuth } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { loadOwned } from '../documents/resolvers.ts';
import { isOcrable } from '../pipeline/mime.ts';
import { VISION_STEP } from '../pipeline/steps/vision.ts';
import { listVisionModels, normalizeBaseUrl } from './models.ts';
import { isConfigured, readVisionSettings, saveVisionSettings } from './settings.ts';

// The vision model that re-reads scanned pages: set in the app by the admin, not in the
// environment, and read by the pipeline at the start of every run (settings.ts).
//
// The settings are the instance's, not a row anyone owns, so a caller who is not the admin is
// told FORBIDDEN, as for pairing sign-in. The API key is written and never read back: the
// settings say only whether one is stored, and the model listing sends the stored key only to
// the base URL it was stored with.

const VISION_SDL = parse(`
  "How closely the model looks at a page: OpenAI's image \`detail\`."
  enum VisionImageDetail {
    "Sent as no \`detail\`, so the server decides."
    AUTO
    "The page scaled to fit 512×512. Much faster on a local model; fine print may be lost."
    LOW
    "The page at full size."
    HIGH
  }

  "How the vision model that re-reads scanned pages is set up. The admin's to read and change."
  type VisionSettings {
    "The OpenAI-compatible base URL, or null when none is set."
    baseUrl: String
    "The model on it that reads pages, or null when none is chosen."
    model: String
    "Whether an API key is stored. The key itself is never read back."
    hasApiKey: Boolean!
    "On, every document OCR runs on is re-read by the model. Off, only a document asked for from its page."
    auto: Boolean!
    "How long one page may take, in seconds."
    requestTimeoutSeconds: Int!
    "The longest reply one page may get, in tokens."
    maxResponseTokens: Int!
    "How closely the model looks at a page."
    imageDetail: VisionImageDetail!
    "Whether a base URL and a model are both set, so documents can be read."
    configured: Boolean!
  }

  input VisionSettingsInput {
    "Empty or null turns the model off."
    baseUrl: String
    model: String
    "A new key. Left out keeps the stored one; an empty string clears it."
    apiKey: String
    auto: Boolean!
    "Left out or null is the default."
    requestTimeoutSeconds: Int
    "Left out or null is the default."
    maxResponseTokens: Int
    "Left out or null is AUTO."
    imageDetail: VisionImageDetail
  }

  "A model an endpoint offers, as its \`/models\` lists it."
  type VisionModel {
    id: String!
    "How many tokens it takes in, when the endpoint says."
    contextLength: Int
  }

  extend type ServerConfig {
    "Whether a vision model is set up, so a document can be read by it."
    visionAvailable: Boolean!
    "Whether it reads every document OCR runs on by itself, rather than only when asked."
    visionAuto: Boolean!
  }

  extend type Query {
    "The admin's only; FORBIDDEN for anyone else."
    visionSettings: VisionSettings!
    """
    The models \`baseUrl\` lists. \`apiKey\` is a key typed but not saved yet, and wins; left out,
    the stored key is sent when \`baseUrl\` is the stored one. The admin's only. BAD_USER_INPUT
    with the reason when the endpoint cannot be reached or does not list models.
    """
    visionModels(baseUrl: String!, apiKey: String): [VisionModel!]!
  }

  extend type Mutation {
    "Stores the vision model's settings. The admin's only."
    setVisionSettings(input: VisionSettingsInput!): VisionSettings!
    """
    Reads a ready or failed PDF or image with the vision model now, then refreshes its date,
    receipt and search passages from the new text. BAD_USER_INPUT when no model is set up or the
    document is not a PDF or an image; CONFLICT while it is being processed.
    """
    readDocumentWithVision(id: UUID!): Document!
  }
`);

// The steps a read with the model re-runs: the read itself, then the two that are built from the
// text it replaces. metadata keeps whatever the user edited, and index swaps the passages in one
// transaction, so running them again over a finished document is safe.
const RERUN_STEPS = [VISION_STEP, 'metadata', 'index'];

const VISION_DETAIL_BY_NAME = {
  AUTO: VisionImageDetail.Auto,
  LOW: VisionImageDetail.Low,
  HIGH: VisionImageDetail.High,
} as const;

const settingsInputSchema = z.object({
  baseUrl: z
    .string()
    .nullish()
    .transform((value) => (value ? normalizeBaseUrl(value) : '') || null)
    .refine(
      (value) => value === null || /^https?:\/\/[^\s/]/i.test(value),
      'A base URL starts with http:// or https://.',
    )
    .refine((value) => value === null || URL.canParse(value), 'That base URL is not a URL.'),
  model: z
    .string()
    .nullish()
    .transform((value) => value?.trim() || null),
  // Left out (or null) keeps the stored key; an empty string clears it.
  apiKey: z
    .string()
    .nullish()
    .transform((value) => (value === undefined || value === null ? undefined : value.trim() || null)),
  auto: z.boolean(),
  requestTimeoutSeconds: z
    .number()
    .int()
    .min(
      VISION_DEFAULTS.minRequestTimeoutSeconds,
      `A page may take at least ${VISION_DEFAULTS.minRequestTimeoutSeconds} seconds.`,
    )
    .max(
      VISION_DEFAULTS.maxRequestTimeoutSeconds,
      `A page may take at most ${VISION_DEFAULTS.maxRequestTimeoutSeconds} seconds.`,
    )
    .nullish()
    .transform((value) => value ?? null),
  maxResponseTokens: z
    .number()
    .int()
    .min(
      VISION_DEFAULTS.minPageMaxTokens,
      `A reply may be capped at no fewer than ${VISION_DEFAULTS.minPageMaxTokens} tokens.`,
    )
    .max(
      VISION_DEFAULTS.maxPageMaxTokens,
      `A reply may be capped at no more than ${VISION_DEFAULTS.maxPageMaxTokens} tokens.`,
    )
    .nullish()
    .transform((value) => value ?? null),
  // The SDL's names are the stored values in capitals.
  imageDetail: z
    .enum(['AUTO', 'LOW', 'HIGH'])
    .nullish()
    .transform((value) => (value ? VISION_DETAIL_BY_NAME[value] : null)),
});

/**
 * Refuses anyone but the admin.
 *
 * @throws UNAUTHENTICATED signed out; FORBIDDEN for anyone else. These are the instance's
 *   settings, not a row, so there is nothing for a NOT_FOUND to hide.
 */
async function requireAdmin(context: Context): Promise<void> {
  const userId = requireAuth(context);
  if ((await isAdmin(context.db, userId)) === false) {
    throw forbidden('Only the admin can set up the vision model.');
  }
}

/** The settings as the admin reads them: whether a key is stored, never the key. */
async function visionSettings(context: Context) {
  const row = await readVisionSettings(context.db);
  return {
    baseUrl: row?.baseUrl ?? null,
    model: row?.model ?? null,
    hasApiKey: Boolean(row?.apiKey),
    auto: row?.auto ?? false,
    requestTimeoutSeconds: row?.requestTimeoutSeconds ?? VISION_DEFAULTS.requestTimeoutSeconds,
    maxResponseTokens: row?.maxResponseTokens ?? VISION_DEFAULTS.pageMaxTokens,
    imageDetail: (row?.imageDetail ?? VisionImageDetail.Auto).toUpperCase(),
    configured: isConfigured(row),
  };
}

// `visionAvailable` and `visionAuto` are two fields of one `serverConfig`, and the row is read
// once for both.
const serverConfigRows = new WeakMap<Context, ReturnType<typeof readVisionSettings>>();
function serverConfigRow(context: Context) {
  let row = serverConfigRows.get(context);
  if (row === undefined) {
    row = readVisionSettings(context.db);
    serverConfigRows.set(context, row);
  }
  return row;
}

/**
 * Adds the vision model's settings, its model listing, and the per-document read to the schema.
 *
 * @param schema - The schema, which must already have Mutation and ServerConfig types.
 * @returns The extended schema.
 */
export function applyVisionExtension(schema: GraphQLSchema): GraphQLSchema {
  const extendedSchema = extendSchema(schema, VISION_SDL);
  const queries = assertObjectType(extendedSchema.getType('Query')).getFields();
  const mutations = assertObjectType(extendedSchema.getType('Mutation')).getFields();
  const serverConfig = assertObjectType(extendedSchema.getType('ServerConfig')).getFields();

  // serverConfig is readable signed out, for the login page; whether a model is set up is
  // nothing a visitor needs, so they are told no.
  serverConfig.visionAvailable.resolve = async (_parent: unknown, _args: unknown, context: Context) =>
    context.userId !== null && isConfigured(await serverConfigRow(context));
  serverConfig.visionAuto.resolve = async (_parent: unknown, _args: unknown, context: Context) => {
    if (context.userId === null) {
      return false;
    }
    const row = await serverConfigRow(context);
    return isConfigured(row) && row?.auto === true;
  };

  queries.visionSettings.resolve = async (_parent: unknown, _args: unknown, context: Context) => {
    await requireAdmin(context);
    return visionSettings(context);
  };

  queries.visionModels.resolve = async (
    _parent: unknown,
    args: { baseUrl: string; apiKey?: string | null },
    context: Context,
  ) => {
    await requireAdmin(context);
    const typed = args.apiKey?.trim();
    if (typed) {
      return listVisionModels(args.baseUrl, typed);
    }
    // The stored key goes only to the endpoint it was stored for: an admin trying another URL
    // must not hand that host the key to the first.
    const row = await readVisionSettings(context.db);
    const sameEndpoint = row?.baseUrl != null && normalizeBaseUrl(args.baseUrl) === row.baseUrl;
    return listVisionModels(args.baseUrl, sameEndpoint ? (row?.apiKey ?? null) : null);
  };

  mutations.setVisionSettings.resolve = async (_parent: unknown, args: { input: unknown }, context: Context) => {
    await requireAdmin(context);
    const input = parseOrThrow(settingsInputSchema, args.input);
    await saveVisionSettings(context.db, input);
    return visionSettings(context);
  };

  mutations.readDocumentWithVision.resolve = async (_parent: unknown, args: { id: string }, context: Context) => {
    const doc = await loadOwned(context, args.id);
    if (isConfigured(await readVisionSettings(context.db)) === false) {
      throw badInput('No vision model is set up. The admin sets one up in Settings.');
    }
    if (isOcrable(doc.mimeType) === false) {
      throw badInput('Only a PDF or an image can be read by the vision model.');
    }
    if (doc.status === DocumentStatus.PendingUpload) {
      throw badInput('The upload has not finished yet.');
    }
    if (doc.status !== DocumentStatus.Ready && doc.status !== DocumentStatus.Failed) {
      throw conflict('This document is already being processed.');
    }

    // Claimed and reset in one transaction, conditional on the status it was read with, so two
    // requests at once start one run, as with retry and reprocess. The archive and the text are
    // kept: the step renders the archive's upright pages, and a failed read leaves the old text.
    // The runner inserts the vision row for a document that has none.
    const updated = await context.db.transaction(async (tx): Promise<Document | null> => {
      const [claimed] = await tx
        .update(documents)
        .set({ status: DocumentStatus.Uploaded, error: null, visionRequested: true })
        .where(and(eq(documents.id, doc.id), inArray(documents.status, [DocumentStatus.Ready, DocumentStatus.Failed])))
        .returning();
      if (!claimed) {
        return null;
      }
      await tx
        .update(processingSteps)
        .set({ status: StepStatus.Queued, error: null, startedAt: null, finishedAt: null })
        .where(
          and(
            eq(processingSteps.documentId, doc.id),
            or(inArray(processingSteps.step, RERUN_STEPS), eq(processingSteps.status, StepStatus.Failed)),
          ),
        );
      return claimed;
    });
    if (updated === null) {
      return loadOwned(context, args.id);
    }

    context.events.emit('document.uploaded', { documentId: doc.id });
    return updated;
  };

  return extendedSchema;
}
