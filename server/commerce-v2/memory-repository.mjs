import {
  clone,
  invariant,
  requiredText
} from "./canonical.mjs";

function commandKey(tenantId, commandId) {
  return `${tenantId}\u0000${commandId}`;
}

export function createMemoryCommerceV2Repository() {
  const commands = new Map();
  const quotes = new Map();
  const checkoutPreparations = new Map();

  return Object.freeze({
    async claimCommand(command) {
      const tenantId = requiredText(
        command?.tenantId,
        "command.tenantId"
      );
      const commandId = requiredText(
        command?.commandId,
        "command.commandId"
      );
      const operation = requiredText(
        command?.operation,
        "command.operation"
      );
      const fingerprint = requiredText(
        command?.fingerprint,
        "command.fingerprint"
      );
      const customerId = requiredText(
        command?.customerId,
        "command.customerId"
      );
      const actorId = requiredText(
        command?.actorId,
        "command.actorId"
      );
      const projectId = requiredText(
        command?.projectId,
        "command.projectId"
      );
      const key = commandKey(tenantId, commandId);
      const previous = commands.get(key);
      if (!previous) {
        commands.set(key, {
          tenantId,
          commandId,
          operation,
          fingerprint,
          customerId,
          actorId,
          projectId,
          state: "pending",
          result: null
        });
        return { status: "claimed" };
      }
      if (
        previous.operation !== operation ||
        previous.fingerprint !== fingerprint ||
        previous.customerId !== customerId ||
        previous.actorId !== actorId ||
        previous.projectId !== projectId
      ) {
        return { status: "conflict" };
      }
      if (previous.state === "complete") {
        return {
          status: "replay",
          result: clone(previous.result)
        };
      }
      return { status: "pending" };
    },

    async commitQuoteCommand(command, quote) {
      const key = commandKey(
        command.tenantId,
        command.commandId
      );
      const previous = commands.get(key);
      invariant(
        previous &&
          previous.state === "pending" &&
          previous.operation === command.operation &&
          previous.fingerprint === command.fingerprint &&
          previous.customerId === command.customerId &&
          previous.actorId === command.actorId &&
          previous.projectId === command.projectId,
        "repository_conflict",
        "the command claim changed before completion",
        { status: 500 }
      );
      invariant(
        !quotes.has(quote.quoteId),
        "repository_conflict",
        "the quote identifier already exists",
        { status: 500 }
      );
      quotes.set(quote.quoteId, clone(quote));
      previous.state = "complete";
      previous.result = clone(quote);
    },

    async commitCheckoutCommand(command, preparation) {
      const key = commandKey(
        command.tenantId,
        command.commandId
      );
      const previous = commands.get(key);
      invariant(
        previous &&
          previous.state === "pending" &&
          previous.operation === command.operation &&
          previous.fingerprint === command.fingerprint &&
          previous.customerId === command.customerId &&
          previous.actorId === command.actorId &&
          previous.projectId === command.projectId,
        "repository_conflict",
        "the command claim changed before completion",
        { status: 500 }
      );
      invariant(
        !checkoutPreparations.has(key),
        "repository_conflict",
        "the checkout command identifier already exists",
        { status: 500 }
      );
      checkoutPreparations.set(
        key,
        clone(preparation)
      );
      previous.state = "complete";
      previous.result = clone(preparation);
    },

    async abandonCommand(command) {
      const key = commandKey(
        command.tenantId,
        command.commandId
      );
      const previous = commands.get(key);
      if (
        previous?.state === "pending" &&
        previous.operation === command.operation &&
        previous.fingerprint === command.fingerprint &&
        previous.customerId === command.customerId &&
        previous.actorId === command.actorId &&
        previous.projectId === command.projectId
      ) {
        commands.delete(key);
      }
    },

    async findQuote({
      tenantId,
      customerId,
      projectId,
      quoteId
    } = {}) {
      const quote = quotes.get(quoteId);
      if (
        quote?.tenantId !== tenantId ||
        quote?.customerId !== customerId ||
        quote?.project?.projectId !== projectId
      ) {
        return null;
      }
      return clone(quote);
    },

    inspect() {
      return {
        commands: clone([...commands.values()]),
        quotes: clone([...quotes.values()]),
        checkoutPreparations: clone(
          [...checkoutPreparations.values()]
        )
      };
    }
  });
}
