// Unit conversions and protocol numbers, by name.

export const MS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_DAY = 86_400;
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
