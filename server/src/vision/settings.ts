import type { DB } from '@cubicecho/engrafo-db';
import * as dbSchema from '@cubicecho/engrafo-db/schema';
import { VISION_DEFAULTS } from '../core/defaults.ts';

// The vision model lives in the `vision_settings` row, set by the admin in the app, and not in the
// environment: a self-hoster points it at the GPU box from Settings without editing a compose file
// and restarting. The pipeline reads it at the start of every run (pipeline/runner.ts), so a change
// reaches the next document.

/**
 * The sampler fields the admin set beside the temperature, by their camel-case names. Only the
 * ones set are present: one left out is not sent, so the server's own default applies.
 */
export interface VisionSampler {
  topP?: number;
  topK?: number;
  minP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  repeatPenalty?: number;
}

/** The sampler fields, as the row and the update name them. */
export const VISION_SAMPLER_FIELDS = [
  'topP',
  'topK',
  'minP',
  'presencePenalty',
  'frequencyPenalty',
  'repeatPenalty',
] as const satisfies readonly (keyof VisionSampler)[];

/** Each sampler field's name in an OpenAI-compatible request. */
const SAMPLER_WIRE_NAMES: Readonly<Record<keyof VisionSampler, string>> = {
  topP: 'top_p',
  topK: 'top_k',
  minP: 'min_p',
  presencePenalty: 'presence_penalty',
  frequencyPenalty: 'frequency_penalty',
  repeatPenalty: 'repeat_penalty',
};

/**
 * The sampler fields as a request's extra body.
 *
 * @param sampler - The fields the admin set.
 * @returns Each one under its wire name; nothing for one not set, so the server keeps its default.
 */
export function samplerBody(sampler: VisionSampler): Record<string, number> {
  const body: Record<string, number> = {};
  for (const field of VISION_SAMPLER_FIELDS) {
    const value = sampler[field];
    if (value !== undefined) {
      body[SAMPLER_WIRE_NAMES[field]] = value;
    }
  }
  return body;
}

/** What a run needs to reach the model. Only built when there is one to reach. */
export interface VisionConfig {
  /** The OpenAI-compatible base URL. */
  baseUrl: string;
  /** Empty when none is stored, which a local server ignores. */
  apiKey: string;
  model: string;
  /** How long one page may take. */
  requestTimeoutSeconds: number;
  /** The longest reply one page may get, in tokens. */
  maxResponseTokens: number;
  /** The image part's `detail`. `auto` sends none. */
  imageDetail: dbSchema.VisionImageDetail;
  /** The sampling temperature. */
  temperature: number;
  /** The other sampler fields, those set only. */
  sampler: VisionSampler;
  /** What the model is asked to write: the page's text as it reads, or Markdown. */
  textFormat: dbSchema.ContentFormat;
  /** Whether every document OCR runs on is read, rather than only one someone asked for. */
  auto: boolean;
}

/** What `saveVisionSettings` writes. */
export interface VisionSettingsUpdate {
  baseUrl: string | null;
  model: string | null;
  /** Undefined keeps the stored key; null clears it. */
  apiKey: string | null | undefined;
  auto: boolean;
  /** Null is `VISION_DEFAULTS.requestTimeoutSeconds`. */
  requestTimeoutSeconds: number | null;
  /** Null is `VISION_DEFAULTS.pageMaxTokens`. */
  maxResponseTokens: number | null;
  /** Null is `auto`. */
  imageDetail: dbSchema.VisionImageDetail | null;
  /** Null is `VISION_DEFAULTS.temperature`. */
  temperature: number | null;
  /** Each null is not sent. */
  topP: number | null;
  topK: number | null;
  minP: number | null;
  presencePenalty: number | null;
  frequencyPenalty: number | null;
  repeatPenalty: number | null;
  /** Null is plain. */
  textFormat: dbSchema.ContentFormat | null;
}

/**
 * Reads the settings row.
 *
 * @param db - The database.
 * @returns The row, or null before anything was ever saved.
 */
export async function readVisionSettings(db: DB): Promise<dbSchema.VisionSettings | null> {
  const [row] = await db.select().from(dbSchema.visionSettings).limit(1);
  return row ?? null;
}

/**
 * Whether a row names both halves of a model to reach.
 *
 * @param row - The settings row, or null.
 * @returns True when a base URL and a model are both set.
 */
export function isConfigured(row: dbSchema.VisionSettings | null): boolean {
  return Boolean(row?.baseUrl) && Boolean(row?.model);
}

/**
 * Reads what a run needs to reach the vision model.
 *
 * @param db - The database.
 * @returns The model's settings, or null when no base URL and model are both set, which is off.
 */
export async function loadVisionConfig(db: DB): Promise<VisionConfig | null> {
  const row = await readVisionSettings(db);
  if (row === null || row.baseUrl === null || row.model === null || isConfigured(row) === false) {
    return null;
  }
  return {
    baseUrl: row.baseUrl,
    apiKey: row.apiKey ?? '',
    model: row.model,
    requestTimeoutSeconds: row.requestTimeoutSeconds ?? VISION_DEFAULTS.requestTimeoutSeconds,
    maxResponseTokens: row.maxResponseTokens ?? VISION_DEFAULTS.pageMaxTokens,
    imageDetail: row.imageDetail ?? dbSchema.VisionImageDetail.Auto,
    temperature: row.temperature ?? VISION_DEFAULTS.temperature,
    sampler: samplerOf(row),
    textFormat: row.textFormat ?? dbSchema.ContentFormat.Plain,
    auto: row.auto,
  };
}

/**
 * The sampler fields a row sets.
 *
 * @param row - The settings row.
 * @returns Each field that is not null, under its own name.
 */
export function samplerOf(row: dbSchema.VisionSettings): VisionSampler {
  const sampler: VisionSampler = {};
  for (const field of VISION_SAMPLER_FIELDS) {
    const value = row[field];
    if (value !== null) {
      sampler[field] = value;
    }
  }
  return sampler;
}

/**
 * Writes the settings row, creating it the first time.
 *
 * @param db - The database.
 * @param update - The new settings. A key left undefined is kept as stored.
 * @returns The row as saved.
 */
export async function saveVisionSettings(db: DB, update: VisionSettingsUpdate): Promise<dbSchema.VisionSettings> {
  const { apiKey, ...rest } = update;
  const values = apiKey === undefined ? rest : { ...rest, apiKey };
  const [row] = await db
    .insert(dbSchema.visionSettings)
    .values(values)
    .onConflictDoUpdate({ target: dbSchema.visionSettings.id, set: { ...values, updatedAt: new Date() } })
    .returning();
  return row;
}
