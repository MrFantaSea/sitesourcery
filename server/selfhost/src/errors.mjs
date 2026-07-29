export class SelfHostError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "SelfHostError";
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new SelfHostError(code, message, details);
}

export function invariant(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}
