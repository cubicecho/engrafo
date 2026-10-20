import { GraphQLError } from 'graphql';
import type { Context } from './context.ts';

/** Every `extensions.code` this API answers with. The client branches on these, never on a message. */
export const ErrorCode = {
  Unauthenticated: 'UNAUTHENTICATED',
  NotFound: 'NOT_FOUND',
  BadUserInput: 'BAD_USER_INPUT',
  TooManyRequests: 'TOO_MANY_REQUESTS',
  Forbidden: 'FORBIDDEN',
  Conflict: 'CONFLICT',
} as const;
/** One of the codes in `ErrorCode`. */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Builds an error the client can branch on.
 *
 * @param message - What went wrong, in words a person can read.
 * @param code - Which kind of failure it is.
 * @param [extensions] - Anything else the client needs alongside the code.
 * @returns The error, for the caller to throw.
 */
export function withCode(message: string, code: ErrorCode, extensions: Record<string, unknown> = {}): GraphQLError {
  return new GraphQLError(message, { extensions: { ...extensions, code } });
}

/**
 * The caller sent something this API cannot accept.
 *
 * @param message - What was wrong with it.
 * @returns A BAD_USER_INPUT error.
 */
export function badInput(message: string): GraphQLError {
  return withCode(message, ErrorCode.BadUserInput);
}

/**
 * The row does not exist, or is not the caller's — which the caller may not tell apart.
 *
 * @param message - What was not found.
 * @returns A NOT_FOUND error.
 */
export function notFound(message: string): GraphQLError {
  return withCode(message, ErrorCode.NotFound);
}

/**
 * The caller may not change something about the instance itself, such as how it signs people in.
 * Never for a row: a row the caller may not touch is NOT_FOUND, so its existence is not confirmed.
 *
 * @param message - Why not, and where it can be changed instead.
 * @returns A FORBIDDEN error.
 */
export function forbidden(message: string): GraphQLError {
  return withCode(message, ErrorCode.Forbidden);
}

/**
 * The request is fine, but the instance is in a state that refuses it, such as pairing twice.
 *
 * @param message - What has to happen first.
 * @returns A CONFLICT error.
 */
export function conflict(message: string): GraphQLError {
  return withCode(message, ErrorCode.Conflict);
}

/**
 * The caller is over a budget.
 *
 * @param message - What to tell them.
 * @param retryAfter - Seconds until the budget has room again.
 * @returns A TOO_MANY_REQUESTS error carrying `retryAfter`.
 */
export function rateLimited(message: string, retryAfter: number): GraphQLError {
  return withCode(message, ErrorCode.TooManyRequests, { retryAfter });
}

/**
 * There is no session, or it is over. The client drops its token on this code.
 *
 * @param [message] - What to tell them.
 * @returns An UNAUTHENTICATED error.
 */
export function unauthenticated(message = 'Unauthenticated'): GraphQLError {
  return withCode(message, ErrorCode.Unauthenticated);
}

/**
 * Names the signed-in user, or refuses.
 *
 * @param ctx - The request's context.
 * @returns The caller's user id.
 * @throws An UNAUTHENTICATED error when nobody is signed in.
 */
export function requireAuth(ctx: Context): string {
  if (ctx.userId === null) {
    throw unauthenticated();
  }
  return ctx.userId;
}

/**
 * Reads a message off whatever was thrown.
 *
 * @param error - The caught value, which need not be an Error.
 * @returns Its message, or the value as a string.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every message down an error's `cause` chain, outermost first.
 *
 * @param error - Anything thrown.
 * @returns The messages joined with newlines.
 *
 * @remarks
 * A wrapper often says only where it failed: drizzle's is "Failed query: …", and what Postgres
 * said is its cause. Stops at a cycle.
 */
export function errorChainMessage(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && seen.has(current) === false) {
    seen.add(current);
    messages.push(errorMessage(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages.join('\n');
}
