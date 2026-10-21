/**
 * Standard HTTP Status Codes and SaaS Application Error Codes
 * RFC 7231, RFC 6585, RFC 7519
 */

export const HttpStatus = {
  // 2xx Success
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,

  // 3xx Redirection
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  SEE_OTHER: 303,
  NOT_MODIFIED: 304,

  // 4xx Client Errors
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  GONE: 410,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,

  // 5xx Server Errors
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

export type HttpStatusCode = typeof HttpStatus[keyof typeof HttpStatus];

/**
 * Standardized Machine-Readable Error Codes
 */
export const ErrorCode = {
  // Authentication & Authorization (401, 403)
  AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
  AUTH_INVALID_HEADER: 'AUTH_INVALID_HEADER',
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_REFRESH_EXPIRED: 'AUTH_REFRESH_EXPIRED',
  AUTH_REFRESH_INVALID: 'AUTH_REFRESH_INVALID',
  FORBIDDEN_ACCESS: 'FORBIDDEN_ACCESS',
  TENANT_MISMATCH: 'TENANT_MISMATCH',

  // Validation & Client Errors (400, 422)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_PARAMETERS: 'INVALID_PARAMETERS',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',

  // Shopify & Rate Limits (429, 502)
  SHOPIFY_API_ERROR: 'SHOPIFY_API_ERROR',
  SHOPIFY_RATE_LIMIT: 'SHOPIFY_RATE_LIMIT',
  SHOPIFY_UNAUTHORIZED: 'SHOPIFY_UNAUTHORIZED',
  WEBHOOK_HMAC_INVALID: 'WEBHOOK_HMAC_INVALID',

  // Server Errors (500, 503)
  DATABASE_ERROR: 'DATABASE_ERROR',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

/**
 * Human-readable default status descriptions
 */
export const HttpStatusMessages: Record<number, string> = {
  200: 'OK - The request has succeeded.',
  201: 'Created - The resource has been created successfully.',
  204: 'No Content - Request executed successfully with no return payload.',
  400: 'Bad Request - The request could not be understood or was missing required parameters.',
  401: 'Unauthorized - Authentication is required or the provided token is invalid / expired.',
  403: 'Forbidden - The server understood the request but refuses to authorize it.',
  404: 'Not Found - The requested resource could not be found.',
  409: 'Conflict - The request conflicts with current state of the resource.',
  422: 'Unprocessable Entity - Semantic validation error in request body.',
  429: 'Too Many Requests - Rate limit exceeded. Please back off and retry later.',
  500: 'Internal Server Error - An unexpected error occurred on the server.',
  502: 'Bad Gateway - Invalid response received from an upstream service.',
  503: 'Service Unavailable - Server is temporarily unable to handle the request.',
  504: 'Gateway Timeout - Upstream server failed to respond in time.',
};

export function getHttpStatusMessage(status: number): string {
  return HttpStatusMessages[status] || `HTTP Status ${status}`;
}
