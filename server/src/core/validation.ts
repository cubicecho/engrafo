import type { z } from 'zod';
import { badInput } from './errors.ts';

/**
 * Checks input against a schema.
 *
 * @param schema - What the input has to look like.
 * @param value - What the caller sent.
 * @returns The parsed value.
 * @throws A BAD_USER_INPUT error carrying the first issue's message.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success === false) {
    throw badInput(result.error.issues[0]?.message ?? 'Invalid input');
  }
  return result.data;
}
