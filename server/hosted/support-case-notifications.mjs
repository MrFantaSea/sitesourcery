import { randomUUID } from "node:crypto";
import { previewReviewedNotificationMail } from "../../ops/notification-mail-private-renderer.mjs";
import { normalizeMailReservation } from "./mail-lifecycle.mjs";
import { digest } from "./security.mjs";
import { invariant } from "./errors.mjs";

const NOTIFICATIONS = Object.freeze({
  open: ["acknowledgment", "open"],
  appeal_open: ["appeal_acknowledgment", "open"],
  respond: ["response", "responded"],
  deny: ["denial", "denied"],
  close: ["closure", "closed"]
});

// The caller has already authorized and written the exact case while holding
// its row lock in a serializable transaction. This only prepares durable mail;
// the existing independently approved worker remains the sole sending path.
export async function reserveSupportCaseNotification(client, { caseId, action, recordedAt }) {
  const selected = NOTIFICATIONS[action];
  if (!selected) return null;
  const row = (await client.query(
    "select * from ss.hosted_support_cases where id = $1", [caseId]
  )).rows[0];
  invariant(row && row.state === selected[1], "SUPPORT_CASE_MAIL_STATE_INVALID",
    "The case notification does not match its recorded decision.", { status: 409 });
  // Preserve the existing project-only mail contract. Manual intake and
  // account/general audit cases are not an automatic recipient authority.
  if (row.intake_channel !== "authenticated" || row.scope_kind !== "project" ||
      !row.requester_user_id) return null;
  const kind = selected[0];
  invariant((action !== "open" || row.request_kind !== "appeal") &&
    (action !== "appeal_open" || row.request_kind === "appeal"),
  "SUPPORT_CASE_MAIL_STATE_INVALID", "The case opening notification is invalid.", { status: 409 });
  const prior = (await client.query(`select mail_message_id from ss.hosted_support_case_mail_reservations
    where case_id = $1 and notification_kind = $2`, [caseId, kind])).rows[0];
  // Existing explicit reservations remain authoritative, including delivered
  // or expired ones. A case action never retries or replaces a prior message.
  if (prior) return { messageId: prior.mail_message_id, kind, alreadyReserved: true };
  const originalActor = (await client.query(
    "select current_setting('app.service_actor_kind', true) as kind"
  )).rows[0].kind;
  await client.query("select set_config('app.service_actor_kind', 'system', true)");
  async function reserve() {
    const account = (await client.query(`select u.email from auth.users u
      join ss.hosted_account_profiles profile on profile.user_id=u.id and profile.state='active'
      join ss.organization_memberships membership on membership.user_id=u.id
        and membership.organization_id=$2 and membership.state='active'
      join ss.organizations organization on organization.id=$2 and organization.state='active'
      join ss.projects project on project.id=$3 and project.organization_id=$2 and project.lifecycle='active'
      where u.id=$1 and u.disabled_at is null`,
    [row.requester_user_id, row.organization_id, row.project_id])).rows[0];
    if (!account) return null;
    const templateVersion = `support-case-${kind.replaceAll("_", "-")}.v1`;
    const preview = previewReviewedNotificationMail({
      templateVersion, to: account.email, variables: { reference: caseId }
    });
    const suppressed = (await client.query(`select 1 from ss.hosted_mail_recipient_suppressions
      where recipient_digest=$1`, [preview.evidence.recipientDigest])).rows.length > 0;
    if (suppressed) return null;
    const input = normalizeMailReservation({
      commandId: `support-case-mail:${caseId}:${kind}`,
      messageType: "support_notification", organizationId: row.organization_id,
      projectId: row.project_id, customerUserId: row.requester_user_id,
      templateVersion, ...preview.evidence,
      expiresAt: new Date(Date.parse(recordedAt) + 30 * 86400000).toISOString()
    }, recordedAt);
    const messageId = randomUUID();
    await client.query(`insert into ss.hosted_mail_deliveries (
      id, command_id, request_digest, message_type, organization_id, project_id,
      customer_user_id, recipient_digest, subject_reference_digest, content_digest,
      template_version, state, requested_at, expires_at, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13,$12,$12)`,
    [messageId, input.commandId, input.requestDigest, input.messageType,
      input.organizationId, input.projectId, input.customerUserId,
      input.recipientDigest, input.subjectReferenceDigest, input.contentDigest,
      input.templateVersion, input.requestedAt, input.expiresAt]);
    const reservationDigest = digest({ schema: "sitesourcery.support-case-mail-reservation/v1",
      caseId, mailMessageId: messageId, notificationKind: kind });
    await client.query(`insert into ss.hosted_support_case_mail_reservations
      (id,case_id,notification_kind,mail_message_id,reservation_digest,reserved_at,created_at)
      values ($1,$2,$3,$4,$5,$6,$6)`,
    [randomUUID(), caseId, kind, messageId, reservationDigest, recordedAt]);
    return { messageId, kind, reservationDigest };
  }
  // Any query/render failure escapes to the caller's transaction rollback;
  // never catch it as a successful case change or commit an orphan mail row.
  const result = await reserve();
  await client.query("select set_config('app.service_actor_kind', $1, true)", [originalActor ?? ""]);
  if (!result) return null;
  // This reservation belongs to the original authorized case action. Restore
  // its exact actor before the audit trigger verifies kind and user together.
  await client.query(`insert into ss.hosted_support_case_events
    (id,case_id,event_sequence,predecessor_event_id,event_kind,actor_kind,
     actor_user_id,evidence_digest,occurred_at,recorded_at,event_digest,created_at)
    values ($1,$2,1,null,'notification_reserved',ss.current_service_actor_kind(),
      ss.current_service_actor_user_id(),$3,$4,$4,$3,$4)`,
  [randomUUID(), caseId, result.reservationDigest, recordedAt]);
  return { messageId: result.messageId, kind, alreadyReserved: false };
}
