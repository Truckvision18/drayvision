import type { ApiError, ApiErrorCode } from '@drayvision/shared';

/**
 * Every deliberate API failure. The error handler turns these into the shared `ApiError`
 * payload `{ error: CODE, message, ...extra }`; anything else becomes an opaque 500.
 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly extra: Partial<Pick<ApiError, 'missing_fields' | 'current_version'>> = {},
  ) {
    super(message);
  }

  toBody(): ApiError {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, 'BAD_REQUEST', message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, 'NOT_FOUND', message);
  }
}
