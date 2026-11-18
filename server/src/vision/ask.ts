import { askReply, type SideTaskOptions, type SideTaskReply } from '@cubicecho/agent-core';
import { samplerBody, type VisionConfig } from './settings.ts';

// The admin's vision model reads text as well as pages, so the jobs that only need words asked of
// it (a title, whether one page continues another) ask it here, with no image: the stored
// endpoint and key, the admin's temperature and sampler, and a timeout of the job's own.

/** What a text-only question sets for itself. */
export interface TextQuestionOptions {
  /** The longest reply, in tokens. */
  maxTokens: number;
  /** The longest the answer may take, in seconds, when the admin's per-page timeout is longer. */
  maxTimeoutSeconds: number;
  /** Where agent-core's notices go: what the endpoint refused and was retried without. */
  onNotice: NonNullable<SideTaskOptions['onNotice']>;
  /** Abandons the call. */
  signal?: AbortSignal;
}

/**
 * Asks the vision model a question in words.
 *
 * @param vision - The admin's settings, from `loadVisionConfig`.
 * @param system - The instruction.
 * @param user - The material it applies to.
 * @param options - The reply's ceiling, the timeout, where notices go, and a signal.
 * @returns The reply and why it ended. One that hit `maxTokens` is returned, not thrown.
 * @throws Whatever the request throws: the endpoint down, refusing, or too slow.
 */
export function askTextQuestion(
  vision: VisionConfig,
  system: string,
  user: string,
  { maxTokens, maxTimeoutSeconds, onNotice, signal }: TextQuestionOptions,
): Promise<SideTaskReply> {
  // The admin's timeout is per page and can be ten minutes.
  const endpoint = { ...vision, requestTimeoutSeconds: Math.min(vision.requestTimeoutSeconds, maxTimeoutSeconds) };
  return askReply(endpoint, vision.model, system, user, {
    maxTokens,
    temperature: vision.temperature,
    extraBody: samplerBody(vision.sampler),
    onNotice,
    signal,
  });
}
