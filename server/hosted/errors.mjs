export class HostedError extends Error {
  constructor(code, message, { status = 400, details = null } = {}) {
    super(message);
    this.name = "HostedError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function invariant(condition, code, message, options) {
  if (!condition) throw new HostedError(code, message, options);
}

export function notFound(message = "The requested item was not found.") {
  throw new HostedError("NOT_FOUND", message, { status: 404 });
}

export function publicError(error, requestId) {
  const known = error instanceof HostedError;
  return {
    status: known ? error.status : 500,
    body: {
      error: {
        code: known ? error.code : "INTERNAL_ERROR",
        message: known
          ? error.message
          : "The Site Sourcery service could not complete this request.",
        requestId,
        ...(known && error.details ? { details: error.details } : {})
      }
    }
  };
}
