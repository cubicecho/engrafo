import { GraphQLError } from 'graphql';
import type { Context } from './context.ts';

/** Every `extensions.code` this API answers with. The client branches on these, never on a message. */
export const ErrorCode = {
  Unauthenticated: 'UNAUTHENTICATED',
  NotFound: 'NOT_FOUND',
  BadUserInput: 'BAD_USER_INPUT',
  TooManyRequests: 'TOO_MANY_REQUESTS',
} as const;
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
