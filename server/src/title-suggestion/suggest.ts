import { askReply, FinishReason, type SideTaskReply } from '@cubicecho/agent-core';
import type { DB } from '@cubicecho/engrafo-db';
import type { Document } from '@cubicecho/engrafo-db/schema';
import { z } from 'zod';
import { TITLE_SUGGESTION_DEFAULTS } from '../core/defaults.ts';
import { badInput, errorMessage } from '../core/errors.ts';
import { parseOrThrow } from '../core/validation.ts';
import { loadOwnedDocuments } from '../documents/resolvers.ts';
import { readTextStart } from '../pipeline/content.ts';
import type { StorageSet } from '../storage/s3.ts';
import { loadVisionConfig, samplerBody } from '../vision/settings.ts';
import { excerptBudgetChars, SUGGEST_TITLE, sanitizeTitle, type TitleSource, titlePrompt } from './prompt.ts';

// The only model this instance has is the admin's vision model, and an OpenAI-compatible vision
// model reads text as well as pages, so a title is asked of it with no image at all. It is a read:
// nothing is written, and the person edits what comes back before it is used.

/** What `suggestDocumentTitle` is asked. The ids are checked by `loadOwnedDocuments`, so a bad one is NOT_FOUND. */
const suggestInputSchema = z
  .array(z.string())
  .min(1, 'Choose at least one document to name.')
  .max(
    TITLE_SUGGESTION_DEFAULTS.maxDocuments,
    `Name at most ${TITLE_SUGGESTION_DEFAULTS.maxDocuments} documents at a time.`,
  );

/** What a suggestion reads: the documents' rows and their text. */
export interface TitleSuggestionDeps {
  db: DB;
  storage: StorageSet;
}

/** One document as the prompt shows it. A text that cannot be read leaves the title to speak for it. */
async function titleSource(storage: StorageSet, doc: Document, budget: number): Promise<TitleSource> {
  let excerpt = '';
  if (doc.contentKey) {
    try {
      excerpt = await readTextStart(storage.text, doc.contentKey, budget);
    } catch (error) {
      console.warn(`[vision] Could not read the text of ${doc.id} for a title: ${errorMessage(error)}`);
    }
  }
  return { title: doc.title, documentDate: doc.documentDate, vendor: doc.vendor, excerpt };
}

/** Where agent-core's notices go: they say what the endpoint refused and was retried without. */
function notice(message: string): void {
  console.warn(`[vision] ${message}`);
}

/**
 * Asks the vision model for one title for the caller's documents, taken as one in the order given.
 *
 * @param deps - The database and the buckets.
 * @param userId - The caller.
 * @param ids - The documents, in page order.
 * @returns A title the name rule accepts.
 * @throws NOT_FOUND as `loadOwnedDocuments` says; BAD_USER_INPUT for no ids or too many, when no
 *   model is set up, when the model does not answer, and when its answer is no usable title.
 */
export async function suggestDocumentTitle(
  deps: TitleSuggestionDeps,
  userId: string,
  ids: readonly string[],
): Promise<string> {
  const docs = await loadOwnedDocuments(deps.db, userId, parseOrThrow(suggestInputSchema, ids));
  const vision = await loadVisionConfig(deps.db);
  if (vision === null) {
    throw badInput('No vision model is set up. The admin sets one up in Settings.');
  }

  const budget = excerptBudgetChars(docs.length);
  const sources = await Promise.all(docs.map((doc) => titleSource(deps.storage, doc, budget)));
  // The admin's timeout is per page and can be ten minutes; someone is waiting on this one.
  const endpoint = {
    ...vision,
    requestTimeoutSeconds: Math.min(vision.requestTimeoutSeconds, TITLE_SUGGESTION_DEFAULTS.requestTimeoutSeconds),
  };
  let reply: SideTaskReply;
  try {
    reply = await askReply(endpoint, vision.model, SUGGEST_TITLE, titlePrompt(sources), {
      maxTokens: TITLE_SUGGESTION_DEFAULTS.maxResponseTokens,
      temperature: vision.temperature,
      extraBody: samplerBody(vision.sampler),
      onNotice: notice,
    });
  } catch (error) {
    throw badInput(`The model did not answer: ${errorMessage(error)}`);
  }
  // A title is a few words, so a reply that ran into the limit is a model that looped or never
  // stopped thinking, and whatever it wrote is not the answer.
  if (reply.finishReason === FinishReason.Length) {
    throw badInput(
      `The model did not finish: it hit the reply limit of ${TITLE_SUGGESTION_DEFAULTS.maxResponseTokens} tokens. Try again, or type a title.`,
    );
  }
  const title = sanitizeTitle(reply.text);
  if (title === null) {
    throw badInput('The model did not suggest a usable title. Try again, or type one.');
  }
  return title;
}
