import { invariant } from "../errors.mjs";

export function createMemoryDomainRepository() {
  const orders = new Map();
  const commands = new Map();
  const audits = new Map();
  const outbox = new Map();
  const domainClaims = new Map();
  let tail = Promise.resolve();

  function exclusive(work) {
    const running = tail.then(work);
    tail = running.catch(() => {});
    return running;
  }

  function orderKey(tenantId, orderId) {
    return `${tenantId}\u0000${orderId}`;
  }

  function commandKey(tenantId, commandId) {
    return `${tenantId}\u0000${commandId}`;
  }

  function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
  }

  function assertPendingCommand(command) {
    const key = commandKey(command.tenantId, command.commandId);
    const current = commands.get(key);
    invariant(current, "repository_error", "command claim is missing", { status: 500 });
    invariant(
      current.fingerprint === command.fingerprint &&
        current.operation === command.operation &&
        current.status === "pending",
      "repository_error",
      "command claim does not match the pending command",
      { status: 500 }
    );
    return { key, current };
  }

  function validateRecords(order, audit, outgoing) {
    invariant(
      audit.tenantId === order.tenantId &&
        audit.orderId === order.id &&
        audit.orderVersion === order.version,
      "repository_error",
      "audit record does not match committed order",
      { status: 500 }
    );
    invariant(
      outgoing.tenantId === order.tenantId &&
        outgoing.orderId === order.id &&
        outgoing.outboxId === audit.eventId,
      "repository_error",
      "outbox record does not match audit record",
      { status: 500 }
    );
    const key = orderKey(order.tenantId, order.id);
    invariant(
      !(audits.get(key) ?? []).some((row) => row.eventId === audit.eventId) &&
        !outbox.has(outgoing.outboxId),
      "repository_error",
      "audit/outbox identity already exists",
      { status: 500 }
    );
  }

  function appendRecords(order, audit, outgoing) {
    const key = orderKey(order.tenantId, order.id);
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
        if (
          current.fingerprint !== command.fingerprint ||
          current.operation !== command.operation
        ) {
          return { status: "conflict" };
        }
        if (current.status === "pending") return { status: "pending" };
        return { status: "replay", result: clone(current.result) };
      });
    },

    async finishCommand(command) {
      return exclusive(() => {
        const { key, current } = assertPendingCommand(command);
        commands.set(key, {
          ...current,
          status: "completed",
          result: clone(command.result)
        });
      });
    },

    async createOrder({ order, audit, outbox: outgoing, command }) {
      return exclusive(() => {
        const key = orderKey(order.tenantId, order.id);
        invariant(!orders.has(key), "order_exists", "domain order already exists");
        const domainKey = `${order.tenantId}\u0000${order.domain}`;
        invariant(
          !domainClaims.has(domainKey),
          "domain_order_exists",
          "an order already controls this domain in the tenant"
        );
        const claim = assertPendingCommand(command);
        validateRecords(order, audit, outgoing);
        orders.set(key, clone(order));
        domainClaims.set(domainKey, order.id);
        appendRecords(order, audit, outgoing);
        commands.set(claim.key, {
          ...claim.current,
          status: "completed",
          result: clone(command.result)
        });
      });
    },

    async getOrder({ tenantId, orderId }) {
      await tail;
      return clone(orders.get(orderKey(tenantId, orderId)) ?? null);
    },

    async commit({
      tenantId,
      orderId,
      expectedVersion,
      order,
      audit,
      outbox: outgoing,
      command
    }) {
      return exclusive(() => {
        const key = orderKey(tenantId, orderId);
        const current = orders.get(key);
        if (
          !current ||
          current.version !== expectedVersion ||
          order.version !== expectedVersion + 1 ||
          order.tenantId !== tenantId ||
          order.id !== orderId
        ) {
          return false;
        }
        let commandClaim = null;
        if (command) commandClaim = assertPendingCommand(command);
        validateRecords(order, audit, outgoing);
        orders.set(key, clone(order));
        appendRecords(order, audit, outgoing);
        if (commandClaim) {
          commands.set(commandClaim.key, {
            ...commandClaim.current,
            status: "completed",
            result: clone(command.result)
          });
        }
        return true;
      });
    },

    async listAudit({ tenantId, orderId }) {
      await tail;
      return clone(audits.get(orderKey(tenantId, orderId)) ?? []);
    },

    async listOutbox({ tenantId }) {
      await tail;
      return clone(
        [...outbox.values()]
          .filter((item) => item.tenantId === tenantId)
          .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
      );
    },

    // Test/rehearsal inspection only. Never expose this through the account boundary.
    async inspect({ tenantId, orderId }) {
      await tail;
      return clone(orders.get(orderKey(tenantId, orderId)) ?? null);
    }
  });
}
