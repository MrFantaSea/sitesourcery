import { invariant } from "../../domain/errors.mjs";

export function createMemoryCommerceRepository() {
  const quotes = new Map();
  const commands = new Map();
  const audits = new Map();
  const outbox = new Map();
  let tail = Promise.resolve();

  const clone = (value) => (value === undefined ? undefined : structuredClone(value));
  const quoteKey = (tenantId, quoteId) => `${tenantId}\u0000${quoteId}`;
  const commandKey = (tenantId, commandId) => `${tenantId}\u0000${commandId}`;
  function exclusive(work) {
    const running = tail.then(work);
    tail = running.catch(() => {});
    return running;
  }
  function commandClaim(command) {
    const key = commandKey(command.tenantId, command.commandId);
    const current = commands.get(key);
    invariant(current?.status === "pending", "repository_error", "pending command claim missing", { status: 500 });
    invariant(
      current.operation === command.operation && current.fingerprint === command.fingerprint,
      "repository_error",
      "pending command purpose mismatch",
      { status: 500 }
    );
    return { key, current };
  }
  function append(quote, audit, outgoing) {
    invariant(
      audit.tenantId === quote.tenantId &&
        audit.quoteId === quote.id &&
        audit.quoteVersion === quote.version &&
        outgoing.tenantId === quote.tenantId &&
        outgoing.quoteId === quote.id &&
        outgoing.outboxId === audit.eventId,
      "repository_error",
      "quote audit/outbox mismatch",
      { status: 500 }
    );
    const key = quoteKey(quote.tenantId, quote.id);
    invariant(!outbox.has(outgoing.outboxId), "repository_error", "outbox identity already exists", { status: 500 });
    const rows = audits.get(key) ?? [];
    rows.push(clone(audit));
    audits.set(key, rows);
    outbox.set(outgoing.outboxId, { ...clone(outgoing), publishedAt: null });
  }

  return Object.freeze({
    async claimCommand(command) {
      return exclusive(() => {
        const key = commandKey(command.tenantId, command.commandId);
        const current = commands.get(key);
        if (!current) {
          commands.set(key, { ...clone(command), status: "pending", result: null });
          return { status: "new" };
        }
        if (current.operation !== command.operation || current.fingerprint !== command.fingerprint) {
          return { status: "conflict" };
        }
        if (current.status === "pending") return { status: "pending" };
        return { status: "replay", result: clone(current.result) };
      });
    },

    async releaseCommand(command) {
      return exclusive(() => {
        const key = commandKey(command.tenantId, command.commandId);
        const current = commands.get(key);
        if (
          current?.status === "pending" &&
          current.operation === command.operation &&
          current.fingerprint === command.fingerprint
        ) {
          commands.delete(key);
          return true;
        }
        return false;
      });
    },

    async createQuote({ quote, audit, outbox: outgoing, command }) {
      return exclusive(() => {
        const key = quoteKey(quote.tenantId, quote.id);
        invariant(!quotes.has(key), "quote_exists", "quote already exists");
        const claim = commandClaim(command);
        append(quote, audit, outgoing);
        quotes.set(key, clone(quote));
        commands.set(claim.key, { ...claim.current, status: "completed", result: clone(command.result) });
      });
    },

    async getQuote({ tenantId, quoteId }) {
      await tail;
      return clone(quotes.get(quoteKey(tenantId, quoteId)) ?? null);
    },

    async commit({
      tenantId,
      quoteId,
      expectedVersion,
      quote,
      audit,
      outbox: outgoing,
      command = null
    }) {
      return exclusive(() => {
        const key = quoteKey(tenantId, quoteId);
        const current = quotes.get(key);
        if (
          !current ||
          current.version !== expectedVersion ||
          quote.version !== expectedVersion + 1 ||
          quote.tenantId !== tenantId ||
          quote.id !== quoteId
        ) return false;
        const claim = command ? commandClaim(command) : null;
        append(quote, audit, outgoing);
        quotes.set(key, clone(quote));
        if (claim) {
          commands.set(claim.key, { ...claim.current, status: "completed", result: clone(command.result) });
        }
        return true;
      });
    },

    async listAudit({ tenantId, quoteId }) {
      await tail;
      return clone(audits.get(quoteKey(tenantId, quoteId)) ?? []);
    },

    async listOutbox({ tenantId }) {
      await tail;
      return clone([...outbox.values()].filter((row) => row.tenantId === tenantId));
    },

    async inspect({ tenantId, quoteId }) {
      await tail;
      return clone(quotes.get(quoteKey(tenantId, quoteId)) ?? null);
    }
  });
}
