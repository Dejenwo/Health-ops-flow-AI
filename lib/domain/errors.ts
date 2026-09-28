export type ErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT";

export class AppError extends Error {
  readonly code: ErrorCode;
  /** Per-field messages keyed by input name, so forms can show errors next to the field. */
  readonly fields?: Record<string, string>;

  constructor(message: string, code: ErrorCode, fields?: Record<string, string>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.fields = fields;
  }
}

export function notFound(message = "Record not found."): AppError {
  return new AppError(message, "NOT_FOUND");
}

export function forbidden(message = "You do not have permission to perform this action."): AppError {
  return new AppError(message, "FORBIDDEN");
}

export function validationError(message: string): AppError {
  return new AppError(message, "VALIDATION");
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
