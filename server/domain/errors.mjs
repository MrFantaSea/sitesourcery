export class DomainError extends Error {
  constructor(code, message, { status = 409, details = null } = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ExternalEffectError extends Error {
  constructor(code, message, { certainty = "ambiguous", details = null } = {}) {
    super(message);
    this.name = "ExternalEffectError";
    this.code = code;
    this.certainty = certainty;
    this.details = details;
  }
}

export function fail(code, message, options) {
  throw new DomainError(code, message, options);
}

export function invariant(condition, code, message, options) {
  if (!condition) fail(code, message, options);
}
