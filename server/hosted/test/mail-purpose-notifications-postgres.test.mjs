import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresMailPurposeNotificationRepository
} from "../mail-purpose-notifications-postgres.mjs";

const NOW = "2026-08-18T18:00:00.000Z";
const LATER = "2026-08-18T19:00:00.000Z";
const IDS = Object.freeze({
  actor: "10000000-0000-4000-8000-000000000001",
  organization: "20000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
  customer: "40000000-0000-4000-8000-000000000001",
  source: "50000000-0000-4000-8000-000000000001",
  notification: "60000000-0000-4000-8000-000000000001",
  message: "70000000-0000-4000-8000-000000000001"
});
const REQUEST = "1".repeat(64);
const SOURCE_DIGEST = "2".repeat(64);
const MAIL_REQUEST = "3".repeat(64);

function input() {
  return {
    actorId: IDS.actor,
    commandId: "mail-purpose-command-0001",
    requestDigest: REQUEST,
    requestedAt: NOW,
    expiresAt: LATER,
    operatorOrganizationId: IDS.organization,
    purposeKind: "publication_domain",
    notificationKind: "domain_lifecycle_updated",
    templateVersion: "domain-lifecycle-updated.v1",
    source: {
      table: "ss.domain_provider_lifecycle_states",
      id: IDS.source,
      revision: 2,
      digest: SOURCE_DIGEST,
      state: "active"
    },
    recipientDigest: "4".repeat(64),
    subjectReferenceDigest: "5".repeat(64),
    contentDigest: "6".repeat(64)
  };
}

function itemRow() {
  return {
    id: IDS.notification,
    command_id: input().commandId,
    request_digest: REQUEST,
    purpose_kind: input().purposeKind,
    notification_kind: input().notificationKind,
    template_version: input().templateVersion,
    organization_id: IDS.organization,
    project_id: IDS.project,
    source_customer_user_id: IDS.customer,
    reference_id: "example.test",
    source_table: input().source.table,
    source_id: IDS.source,
    source_revision: "2",
    source_digest: SOURCE_DIGEST,
    source_state: "active",
    source_occurred_at: new Date(NOW),
    mail_message_id: IDS.message,
    reservation_digest: "7".repeat(64),
    state: "held",
    reserved_at: new Date(NOW),
    expires_at: new Date(LATER),
    revision: "1",
    mail_state: "pending",
    recipient_digest: input().recipientDigest,
    subject_reference_digest: input().subjectReferenceDigest,
    content_digest: input().contentDigest,
    mail_request_digest: MAIL_REQUEST
  };
}

test("PostgreSQL readiness binds exact contracts, ACLs, constraints, and guard functions", async () => {
  let readinessSql;
  const repository = createPostgresMailPurposeNotificationRepository({
    authority: {
      async service(context, work) {
        assert.deepEqual(context, { actorKind: "system", readOnly: true });
        return work({
          async query(sql) {
            readinessSql = sql;
            return { rows: [{
              purpose_contract_ready: true,
              dispatch_contract_ready: true,
              sources_ready: true,
              rls_ready: true,
              trigger_ready: true,
              scope_trigger_ready: true,
              mail_constraints_ready: true,
              exception_constraint_ready: true,
              dispatch_constraint_ready: true,
              dispatch_trigger_ready: true,
              source_acl_ready: true,
              acl_ready: true
            }] };
          }
        });
      }
    }
  });
  const readiness = await repository.readiness();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.fiveFamilyReservationReady, true);
  assert.equal(readiness.mailReserved, true);
  assert.match(readinessSql, /guard_mail_purpose_notification\(\)/u);
  assert.match(readinessSql, /guard_mail_purpose_notification_mail_scope\(\)/u);
  assert.match(readinessSql, /hosted_mail_exception_projection_message_type_check_v140/u);
  assert.match(readinessSql, /hosted_mail_dispatch_claims_source_kind_check_v140/u);
  assert.doesNotMatch(readinessSql, /has_table_privilege\(\s*'public'/u);
});

test("PostgreSQL reservation uses tenant and semantic locks plus the deterministic global MAIL identity", async () => {
  const locks = [];
  let serviceAttempts = 0;
  const authority = {
    async service(context, work) {
      serviceAttempts += 1;
      if (serviceAttempts === 1) {
        throw Object.assign(new Error("serialization retry"), { code: "40001" });
      }
      assert.deepEqual(context, {
        actorKind: "system",
        isolation: "serializable"
      });
      return work({
        async query(sql, values = []) {
          if (sql.includes("pg_advisory_xact_lock")) {
            locks.push(values[0]);
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes("service_operator_has_capability")) {
            return { rowCount: 1, rows: [{
              management_allowed: true,
              case_allowed: true
            }] };
          }
          if (sql.includes("from ss.mail_purpose_notification_outbox notification") &&
              sql.includes("notification.command_id = $1")) {
            return { rowCount: 0, rows: [] };
          }
          if (sql.includes("from ss.mail_purpose_notification_sources source") &&
              sql.includes("source.source_occurred_at <=")) {
            return { rowCount: 1, rows: [{
              purpose_kind: input().purposeKind,
              notification_kind: input().notificationKind,
              template_version: input().templateVersion,
              source_table: input().source.table,
              source_id: IDS.source,
              source_revision: "2",
              source_digest: SOURCE_DIGEST,
              source_state: "active",
              source_occurred_at: new Date(NOW),
              reference_id: "example.test",
              organization_id: IDS.organization,
              project_id: IDS.project,
              source_customer_user_id: IDS.customer
            }] };
          }
          if (sql.includes("insert into ss.hosted_mail_deliveries")) {
            assert.equal(values[1], `mail-purpose:${REQUEST}`);
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes("insert into ss.mail_purpose_notification_outbox")) {
            assert.equal(values[1], input().commandId);
            assert.equal(values[2], REQUEST);
            return { rowCount: 1, rows: [{ id: IDS.notification }] };
          }
          if (sql.includes("where notification.id = $1")) {
            return { rowCount: 1, rows: [itemRow()] };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        }
      });
    }
  };
  const repository = createPostgresMailPurposeNotificationRepository({
    authority
  });
  const receipt = await repository.reserveOperator(input());
  assert.equal(receipt.id, IDS.notification);
  assert.equal(receipt.mail.messageId, IDS.message);
  assert.equal(receipt.providerEffectsAuthorized, false);
  assert.equal(receipt.deliveryClaimed, false);
  assert.equal(serviceAttempts, 2);
  assert.equal(locks.length, 2);
  assert.match(locks[0], /mail-purpose:.*mail-purpose-command-0001/u);
  assert.match(locks[1], /mail-purpose-source:/u);
});

test("readiness drift cannot claim a mail reservation", async () => {
  const repository = createPostgresMailPurposeNotificationRepository({
    authority: {
      async service(_context, work) {
        return work({
          async query() {
            return { rows: [{
              purpose_contract_ready: true,
              dispatch_contract_ready: true,
              sources_ready: true,
              rls_ready: true,
              trigger_ready: false,
              scope_trigger_ready: true,
              mail_constraints_ready: true,
              exception_constraint_ready: true,
              dispatch_constraint_ready: true,
              dispatch_trigger_ready: true,
              source_acl_ready: true,
              acl_ready: true
            }] };
          }
        });
      }
    }
  });
  const readiness = await repository.readiness();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.mailReserved, false);
  assert.equal(readiness.fiveFamilyReservationReady, false);
});
