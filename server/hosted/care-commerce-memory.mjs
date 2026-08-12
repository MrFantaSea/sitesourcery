import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";

function clone(value) {
  return structuredClone(value);
}

function commandKey(organizationId, commandId) {
  return `${organizationId}\u0000${commandId}`;
}

function assertPending(commands, command) {
  const selected = commands.get(commandKey(
    command.organizationId,
    command.commandId
  ));
  invariant(
    selected &&
      selected.state === "pending" &&
      selected.operation === command.operation &&
      selected.fingerprint === command.fingerprint &&
      selected.actorId === command.actorId &&
      selected.projectId === command.projectId &&
      selected.customerId === command.customerId &&
      selected.contractId === command.contractId &&
      selected.periodId === command.periodId,
    "CARE_COMMERCE_REPOSITORY_CONFLICT",
    "The Care commerce command claim changed before completion.",
    { status: 500 }
  );
  return selected;
}

export function createMemoryCareCommerceRepository() {
  const commands = new Map();
  const quotes = new Map();
  const reservations = new Map();
  const reservationByQuote = new Map();

  return Object.freeze({
    mode: "memory-held-proof",
    durable: false,
    providerEffects: false,
    async readiness() {
      return deepFreeze({
        ready: true,
        verified: true,
        mode: "memory-held-proof",
        durable: false,
        providerEffects: false
      });
    },
    async claimCommand(command) {
      const key = commandKey(command.organizationId, command.commandId);
      const previous = commands.get(key);
      if (!previous) {
        commands.set(key, {
          ...clone(command),
          state: "pending",
          result: null
        });
        return { status: "claimed" };
      }
      if (
        previous.operation !== command.operation ||
        previous.fingerprint !== command.fingerprint ||
        previous.actorId !== command.actorId ||
        previous.projectId !== command.projectId ||
        previous.customerId !== command.customerId ||
        previous.contractId !== command.contractId ||
        previous.periodId !== command.periodId
      ) {
        return { status: "conflict" };
      }
      if (previous.state === "complete") {
        return { status: "replay", result: clone(previous.result) };
      }
      return { status: "pending" };
    },
    async abandonCommand(command) {
      const key = commandKey(command.organizationId, command.commandId);
      const previous = commands.get(key);
      if (
        previous?.state === "pending" &&
        previous.operation === command.operation &&
        previous.fingerprint === command.fingerprint &&
        previous.actorId === command.actorId &&
        previous.projectId === command.projectId
      ) {
        commands.delete(key);
      }
    },
    async commitQuoteCommand(command, quote) {
      const pending = assertPending(commands, command);
      invariant(
        !quotes.has(quote.quoteId),
        "CARE_COMMERCE_REPOSITORY_CONFLICT",
        "The Care quote identifier already exists.",
        { status: 500 }
      );
      quotes.set(quote.quoteId, clone(quote));
      pending.state = "complete";
      pending.result = clone(quote);
    },
    async findQuote(input) {
      const selected = quotes.get(input.quoteId);
      if (
        selected?.organizationId !== input.organizationId ||
        selected?.projectId !== input.projectId ||
        selected?.contractId !== input.contractId ||
        selected?.periodId !== input.periodId
      ) return null;
      return clone(selected);
    },
    async commitReservationCommand(command, reservation) {
      const pending = assertPending(commands, command);
      invariant(
        !reservations.has(reservation.reservationId) &&
          !reservationByQuote.has(reservation.quoteId),
        "CARE_COMMERCE_RESERVATION_OVERLAP",
        "The Care quote already has a held commercial reservation.",
        { status: 409 }
      );
      reservations.set(reservation.reservationId, clone(reservation));
      reservationByQuote.set(reservation.quoteId, reservation.reservationId);
      pending.state = "complete";
      pending.result = clone(reservation);
    },
    async findReservation(input) {
      const selected = reservations.get(input.reservationId);
      if (
        selected?.organizationId !== input.organizationId ||
        selected?.projectId !== input.projectId ||
        selected?.contractId !== input.contractId ||
        selected?.periodId !== input.periodId
      ) return null;
      return clone(selected);
    },
    async commitReservationTransition(command, prior, next) {
      const pending = assertPending(commands, command);
      const selected = reservations.get(prior.reservationId);
      invariant(
        selected &&
          JSON.stringify(selected) === JSON.stringify(prior) &&
          next.reservationId === prior.reservationId &&
          next.revision === prior.revision + 1,
        "CARE_COMMERCE_REPOSITORY_CONFLICT",
        "The Care reservation changed before its held transition.",
        { status: 409 }
      );
      reservations.set(next.reservationId, clone(next));
      pending.state = "complete";
      pending.result = clone(next);
    },
    inspect() {
      return deepFreeze({
        commands: clone([...commands.values()]),
        quotes: clone([...quotes.values()]),
        reservations: clone([...reservations.values()])
      });
    }
  });
}
