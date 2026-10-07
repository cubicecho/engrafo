// Unit conversions and protocol numbers, by name.

/** Milliseconds in one second. */
export const MS_PER_SECOND = 1000;
/** Seconds in one minute. */
export const SECONDS_PER_MINUTE = 60;
/** Seconds in one day. */
export const SECONDS_PER_DAY = 86_400;
/** Bytes in one mebibyte, the unit upload limits are shown in. */
export const BYTES_PER_MEBIBYTE = 1_048_576;

/** The HTTP statuses this server answers with by hand. */
export const HttpStatus = {
  Ok: 200,
  BadRequest: 400,
  Forbidden: 403,
  NotFound: 404,
  MethodNotAllowed: 405,
  ServiceUnavailable: 503,
} as const;
