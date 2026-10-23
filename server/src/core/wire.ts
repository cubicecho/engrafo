// Unit conversions and protocol numbers, by name.

/** Milliseconds in one second. */
export const MS_PER_SECOND = 1000;
/** Seconds in one minute. */
export const SECONDS_PER_MINUTE = 60;
/** Seconds in one day. */
export const SECONDS_PER_DAY = 86_400;
/** Bytes in one mebibyte, the unit upload limits are shown in. */
export const BYTES_PER_KIBIBYTE = 1024;
export const BYTES_PER_MEBIBYTE = 1_048_576;

/** The HTTP statuses this server answers with by hand. */
export const HttpStatus = {
  Ok: 200,
  Found: 302,
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  MethodNotAllowed: 405,
  TooManyRequests: 429,
  InternalServerError: 500,
  ServiceUnavailable: 503,
} as const;
