import {
  ContentFormat,
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
import { folderAndDescendants, loadOwnedFolder } from '../folders/names.ts';
import { isOcrable } from '../pipeline/mime.ts';
import { VISION_STEP } from '../pipeline/steps/vision.ts';
import { notTrashed } from '../trash/trash.ts';
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
  "What the model is asked to write for a page."
  enum VisionTextFormat {
    "The page's text as it reads, line by line."
    PLAIN
    "Markdown: the page's headings, lists, tables and emphasis kept as Markdown."
    MARKDOWN
  }

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
    "The sampling temperature pages are read at, 0 to 2."
    temperature: Float!
    "Nucleus sampling, 0 to 1. Null sends none, so the server's default applies."
    topP: Float
    "How many of the likeliest tokens are sampled from; 0 is all. Null sends none."
    topK: Int
    "The least likely a token may be, relative to the likeliest, 0 to 1. Null sends none."
    minP: Float
    "-2 to 2: above 0 discourages any token already used. Null sends none."
    presencePenalty: Float
    "-2 to 2: above 0 discourages a token the more it has been used. Null sends none."
    frequencyPenalty: Float
    "llama.cpp's repeat penalty, 0 to 2; 1 is none. Null sends none."
    repeatPenalty: Float
    "What the model is asked to write."
    textFormat: VisionTextFormat!
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
    "Left out or null is the default."
    temperature: Float
    "Each left out or null is not sent."
    topP: Float
    topK: Int
    minP: Float
    presencePenalty: Float
    frequencyPenalty: Float
    repeatPenalty: Float
    "Left out or null is PLAIN."
    textFormat: VisionTextFormat
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
    """
    Reads every PDF and image in a folder again with the vision model, as readDocumentWithVision
    does one, and in every folder inside it unless \`includeSubfolders\` is false. A document still
    being processed, or of another type, is left as it is and counted. BAD_USER_INPUT when no
    model is set up; NOT_FOUND for a folder that is not the caller's.
    """
    readFolderWithVision(id: UUID!, includeSubfolders: Boolean = true): FolderVisionRead!
  }

  "What a folder's read with the vision model started."
  type FolderVisionRead {
    "Documents queued to be read."
    queued: Int!
    "PDFs and images left alone because they are still uploading or being processed."
    busy: Int!
    "Documents the model cannot read: not a PDF or an image."
    notReadable: Int!
  }
`);

// The steps a read with the model re-runs: the read itself, then the two that are built from the
// text it replaces. metadata keeps whatever the user edited, and index swaps the passages in one
// transaction, so running them again over a finished document is safe.
const RERUN_STEPS = [VISION_STEP, 'metadata', 'index'];

// A document a read can start on: one the pipeline is done with, either way.
const SETTLED: readonly string[] = [DocumentStatus.Ready, DocumentStatus.Failed];

/**
 * Puts documents back in the pipeline for a read with the vision model, and starts them.
 *
 * @param context - The request's context: its database and the pipeline's events.
 * @param ids - The caller's documents, already checked to be PDFs or images.
 * @returns The documents claimed. One no longer ready or failed is left out and left alone.
 *
 * @remarks
 * Claimed and reset in one transaction, conditional on the status, so two requests at once start
 * one run each document, as with retry and reprocess. The archive and the text are kept: the step
 * renders the archive's upright pages, and a failed read leaves the old text. The runner inserts
 * the vision row for a document that has none.
 */
async function claimForVision(context: Context, ids: readonly string[]): Promise<Document[]> {
  if (ids.length === 0) {
    return [];
  }
  const claimed = await context.db.transaction(async (tx): Promise<Document[]> => {
    const rows = await tx
      .update(documents)
      .set({ status: DocumentStatus.Uploaded, error: null, visionRequested: true })
      .where(
        and(inArray(documents.id, [...ids]), inArray(documents.status, [DocumentStatus.Ready, DocumentStatus.Failed])),
      )
      .returning();
    if (rows.length > 0) {
      await tx
        .update(processingSteps)
        .set({ status: StepStatus.Queued, error: null, startedAt: null, finishedAt: null })
        .where(
          and(
            inArray(
              processingSteps.documentId,
              rows.map((row) => row.id),
            ),
            or(inArray(processingSteps.step, RERUN_STEPS), eq(processingSteps.status, StepStatus.Failed)),
          ),
        );
    }
    return rows;
  });
  for (const doc of claimed) {
    context.events.emit('document.uploaded', { documentId: doc.id });
  }
  return claimed;
}

const VISION_DETAIL_BY_NAME = {
  AUTO: VisionImageDetail.Auto,
  LOW: VisionImageDetail.Low,
  HIGH: VisionImageDetail.High,
} as const;

const VISION_TEXT_FORMAT_BY_NAME = {
  PLAIN: ContentFormat.Plain,
  MARKDOWN: ContentFormat.Markdown,
} as const;

/** A number the admin may leave out, held to a range. Left out or null is null, which sends none. */
function optionalBetween(name: string, min: number, max: number) {
  return z
    .number()
    .min(min, `${name} is at least ${min}.`)
    .max(max, `${name} is at most ${max}.`)
    .nullish()
    .transform((value) => value ?? null);
}

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
  textFormat: z
    .enum(['PLAIN', 'MARKDOWN'])
    .nullish()
    .transform((value) => (value ? VISION_TEXT_FORMAT_BY_NAME[value] : null)),
  temperature: z
    .number()
    .min(0, 'The temperature is at least 0.')
    .max(VISION_DEFAULTS.maxTemperature, `The temperature is at most ${VISION_DEFAULTS.maxTemperature}.`)
    .nullish()
    .transform((value) => value ?? null),
  topP: optionalBetween('Top P', 0, 1),
  topK: z
    .number()
    .int()
    .min(0, 'Top K is at least 0.')
    .nullish()
    .transform((value) => value ?? null),
  minP: optionalBetween('Min P', 0, 1),
  presencePenalty: optionalBetween('The presence penalty', -VISION_DEFAULTS.maxPenalty, VISION_DEFAULTS.maxPenalty),
  frequencyPenalty: optionalBetween('The frequency penalty', -VISION_DEFAULTS.maxPenalty, VISION_DEFAULTS.maxPenalty),
  repeatPenalty: optionalBetween('The repeat penalty', 0, VISION_DEFAULTS.maxRepeatPenalty),
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
    temperature: row?.temperature ?? VISION_DEFAULTS.temperature,
    topP: row?.topP ?? null,
    topK: row?.topK ?? null,
    minP: row?.minP ?? null,
    presencePenalty: row?.presencePenalty ?? null,
    frequencyPenalty: row?.frequencyPenalty ?? null,
    repeatPenalty: row?.repeatPenalty ?? null,
    textFormat: (row?.textFormat ?? ContentFormat.Plain).toUpperCase(),
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

    const [updated] = await claimForVision(context, [doc.id]);
    return updated ?? loadOwned(context, args.id);
  };

  mutations.readFolderWithVision.resolve = async (
    _parent: unknown,
    args: { id: string; includeSubfolders?: boolean | null },
    context: Context,
  ) => {
    const userId = requireAuth(context);
    const folder = await loadOwnedFolder(context.db, userId, args.id);
    if (isConfigured(await readVisionSettings(context.db)) === false) {
      throw badInput('No vision model is set up. The admin sets one up in Settings.');
    }
    const folderIds =
      args.includeSubfolders === false ? [folder.id] : await folderAndDescendants(context.db, userId, folder.id);
    const inside = await context.db
      .select({ id: documents.id, mimeType: documents.mimeType, status: documents.status })
      .from(documents)
      .where(and(eq(documents.userId, userId), inArray(documents.folderId, folderIds), notTrashed()));

    const readable = inside.filter((doc) => isOcrable(doc.mimeType));
    const settled = readable.filter((doc) => SETTLED.includes(doc.status));
    const claimed = await claimForVision(
      context,
      settled.map((doc) => doc.id),
    );
    return {
      queued: claimed.length,
      // Counted after the claim: one that moved on between the read and the claim is busy too.
      busy: readable.length - claimed.length,
      notReadable: inside.length - readable.length,
    };
  };

  return extendedSchema;
}
