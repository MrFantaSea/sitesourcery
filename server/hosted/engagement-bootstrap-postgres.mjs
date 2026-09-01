import {
  createHash,
  randomBytes as systemRandomBytes,
  randomUUID as systemRandomUUID
} from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import {
  hashPasswordWithPepper,
  verifyPasswordWithPepper
} from "./identity-postgres.mjs";
import { canonicalJson } from "./security.mjs";

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function iso(value) {
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    !Number.isNaN(selected.getTime()),
    "ENGAGEMENT_REPOSITORY_CONFLICT",
    "Customer engagement timing is unavailable.",
    { status: 500 }
  );
  return selected.toISOString();
}

function one(result, code, message, { optional = false } = {}) {
  invariant(
    result &&
      Array.isArray(result.rows) &&
      Number.isSafeInteger(result.rowCount) &&
      result.rowCount === result.rows.length &&
      result.rowCount <= 1,
    "ENGAGEMENT_REPOSITORY_CONFLICT",
    "Customer engagement storage returned an invalid result.",
    { status: 500 }
  );
  if (result.rowCount === 0) {
    if (optional) return null;
    throw new HostedError(code, message, { status: 409 });
  }
  return result.rows[0];
}

function publicInvitation(row, replayed) {
  return deepFreeze({
    invitationId: row.id,
    expiresAt: iso(row.expires_at),
    provenance: row.provenance,
    accountMode: row.account_mode,
    customer: {
      userId: row.reserved_customer_user_id,
      name: row.customer_name,
      email: row.customer_email
    },
    organization: {
      id: row.reserved_organization_id,
      name: row.organization_name
    },
    project: {
      id: row.reserved_project_id,
      name: row.project_name,
      site: row.site_kind === "new_site"
        ? { kind: "new_site" }
        : {
            kind: "external_site",
            publicUrl: row.external_site_url,
            hostname: row.external_site_hostname
          }
    },
    sourceAssessmentReportId: row.source_assessment_report_id,
    replayed
  });
}

function publicClaim(row, replayed) {
  return deepFreeze({
    engagementId: row.engagement_id,
    invitationId: row.invitation_id,
    user: {
      id: row.user_id,
      name: row.display_name,
      email: row.email,
      createdAt: iso(row.user_created_at)
    },
    organization: {
      id: row.organization_id,
      name: row.organization_name,
      role: row.organization_role,
      state: row.organization_state,
      createdAt: iso(row.organization_created_at)
    },
    project: {
      id: row.project_id,
      name: row.project_name,
      lifecycle: row.project_lifecycle,
      createdAt: iso(row.project_created_at)
    },
    legalReceipt: {
      id: row.project_legal_receipt_id,
      authorityDigest: row.legal_authority_digest,
      acceptedAt: iso(row.claimed_at)
    },
    provenance: row.provenance,
    sourceAssessmentReportId: row.source_assessment_report_id,
    replayed
  });
}

function claimFailure() {
  return new HostedError(
    "ENGAGEMENT_CLAIM_UNAVAILABLE",
    "Customer engagement claim is unavailable.",
    { status: 409 }
  );
}

export function createPostgresEngagementBootstrapRepository({
  authority,
  legalAuthority,
  pepper,
  pepperVersion = "v1",
  previousPeppers = {},
  clock = () => new Date(),
  randomBytes = systemRandomBytes,
  randomUUID = systemRandomUUID,
  sessionTtlMs = SESSION_MS
} = {}) {
  invariant(
    authority && typeof authority.service === "function",
    "ENGAGEMENT_CONFIGURATION_ERROR",
    "Canonical PostgreSQL authority is required for engagement bootstrap.",
    { status: 500 }
  );
  invariant(
    legalAuthority?.acceptanceSchema ===
      "sitesourcery.project-legal-acceptance/v7" &&
      Array.isArray(legalAuthority.documents) &&
      Array.isArray(legalAuthority.documentBindings) &&
      Array.isArray(legalAuthority.artifactBindings),
    "ENGAGEMENT_CONFIGURATION_ERROR",
    "Released joint legal V7 bindings are required for engagement bootstrap.",
    { status: 500 }
  );
  invariant(
    Buffer.isBuffer(pepper) && pepper.byteLength >= 32,
    "ENGAGEMENT_CONFIGURATION_ERROR",
    "The identity pepper is required for engagement bootstrap.",
    { status: 500 }
  );
  invariant(
    Number.isInteger(sessionTtlMs) &&
      sessionTtlMs >= 60 * 1000 &&
      sessionTtlMs <= 90 * 24 * 60 * 60 * 1000,
    "ENGAGEMENT_CONFIGURATION_ERROR",
    "The engagement session lifetime is invalid.",
    { status: 500 }
  );

  async function pepperFor(version) {
    if (version === pepperVersion) return pepper;
    const prior = previousPeppers[version];
    return Buffer.isBuffer(prior) ? prior : null;
  }

  async function exactLegalDocuments(client, acceptance) {
    const selected = [];
    for (let index = 0; index < legalAuthority.documents.length; index += 1) {
      const document = acceptance.documents[index];
      const binding = legalAuthority.documentBindings[index];
      const artifact = legalAuthority.artifactBindings[index];
      const result = await client.query(
        `select document.id
           from ss.legal_documents document
          where document.id = $1
            and document.kind = $2
            and document.version = $3
            and document.content_digest = $4
            and document.content_uri = $5
            and document.effective_at = $6
            and document.retired_at is null
            and (
              ($7::text is null and not exists (
                select 1 from ss.legal_document_artifacts unexpected
                 where unexpected.document_id = document.id
              ))
              or exists (
                select 1 from ss.legal_document_artifacts exact_artifact
                 where exact_artifact.document_id = document.id
                   and exact_artifact.artifact_uri = $7
                   and exact_artifact.artifact_sha256 = $8
                   and exact_artifact.byte_count = $9
                   and exact_artifact.media_type = $10
              )
            )
          for update of document`,
        [
          binding.id,
          document.kind,
          document.version,
          document.contentDigest,
          document.contentUri,
          document.effectiveAt,
          artifact.artifactUri,
          artifact.artifactSha256 ?? null,
          artifact.byteCount ?? null,
          artifact.mediaType ?? null
        ]
      );
      selected.push(one(
        result,
        "ENGAGEMENT_LEGAL_AUTHORITY_CHANGED",
        "Customer engagement legal authority changed."
      ));
    }
    return selected;
  }

  async function replayClaim(client, invitation, sessionTokenDigest, observedAt) {
    const result = await client.query(
      `select
         engagement.id as engagement_id,
         engagement.invitation_id,
         engagement.organization_id,
         engagement.project_id,
         engagement.project_legal_receipt_id,
         engagement.legal_authority_digest,
         engagement.provenance,
         engagement.source_assessment_report_id,
         engagement.claimed_at,
         account.id as user_id,
         account.email,
         account.created_at as user_created_at,
         profile.display_name,
         organization.name as organization_name,
         organization.state as organization_state,
         organization.created_at as organization_created_at,
         membership.role as organization_role,
         project.name as project_name,
         project.lifecycle as project_lifecycle,
         project.created_at as project_created_at
       from ss.customer_engagements engagement
       join auth.users account on account.id = engagement.customer_user_id
       join ss.hosted_account_profiles profile
         on profile.user_id = account.id
       join ss.organizations organization
         on organization.id = engagement.organization_id
       join ss.organization_memberships membership
         on membership.organization_id = organization.id
        and membership.user_id = account.id
       join ss.projects project
         on project.organization_id = engagement.organization_id
        and project.id = engagement.project_id
       join ss.hosted_sessions session
         on session.user_id = account.id
        and session.token_digest = $2
        and session.revoked_at is null
        and session.expires_at > $3
      where engagement.invitation_id = $1
        and account.disabled_at is null
        and profile.state = 'active'
        and organization.state = 'active'
        and membership.state = 'active'`,
      [invitation.id, sessionTokenDigest, observedAt]
    );
    return publicClaim(one(
      result,
      "ENGAGEMENT_CLAIM_UNAVAILABLE",
      "Customer engagement claim is unavailable."
    ), true);
  }

  return Object.freeze({
    async readiness() {
      try {
        const result = await authority.service(
          { readOnly: true },
          (client) => client.query(`
            select
              ss.hosted_runtime_contract_v106() =
                'canonical-ss-v106-customer-engagement-bootstrap'
                as contract_ready,
              invitation.relrowsecurity
                and invitation.relforcerowsecurity
                and engagement.relrowsecurity
                and engagement.relforcerowsecurity
                as rls_ready,
              has_table_privilege(
                'service_role',
                'ss.customer_engagement_invitations',
                'SELECT,INSERT,UPDATE'
              )
                and not has_table_privilege(
                  'service_role',
                  'ss.customer_engagement_invitations',
                  'DELETE'
                )
                and has_table_privilege(
                  'service_role',
                  'ss.customer_engagements',
                  'SELECT,INSERT'
                )
                and not has_table_privilege(
                  'service_role',
                  'ss.customer_engagements',
                  'UPDATE,DELETE'
                )
                and not has_table_privilege(
                  'anon',
                  'ss.customer_engagement_invitations',
                  'SELECT,INSERT,UPDATE,DELETE'
                )
                and not has_table_privilege(
                  'authenticated',
                  'ss.customer_engagement_invitations',
                  'SELECT,INSERT,UPDATE,DELETE'
                )
                and has_table_privilege(
                  'authenticated',
                  'ss.customer_engagements',
                  'SELECT'
                )
                and not has_table_privilege(
                  'authenticated',
                  'ss.customer_engagements',
                  'INSERT,UPDATE,DELETE'
                ) as grants_ready,
              exists (
                select 1
                  from pg_catalog.pg_trigger trigger
                 where trigger.tgrelid = invitation.oid
                   and trigger.tgname =
                     'customer_engagement_invitations_guard'
                   and trigger.tgenabled <> 'D'
              )
                and exists (
                  select 1
                    from pg_catalog.pg_trigger trigger
                   where trigger.tgrelid = engagement.oid
                     and trigger.tgname =
                       'customer_engagements_guard'
                     and trigger.tgenabled <> 'D'
                ) as triggers_ready
              from pg_catalog.pg_class invitation
              join pg_catalog.pg_class engagement
                on engagement.oid =
                  to_regclass('ss.customer_engagements')
             where invitation.oid =
               to_regclass('ss.customer_engagement_invitations')
          `)
        );
        const row = result.rows[0];
        const ready = row?.contract_ready === true &&
          row?.rls_ready === true &&
          row?.grants_ready === true &&
          row?.triggers_ready === true;
        return Object.freeze({
          ready,
          kind: "canonical-postgres-engagement-bootstrap",
          ...(ready ? {} : { code: "ENGAGEMENT_SCHEMA_NOT_READY" })
        });
      } catch {
        return Object.freeze({
          ready: false,
          kind: "canonical-postgres-engagement-bootstrap",
          code: "ENGAGEMENT_SCHEMA_NOT_READY"
        });
      }
    },

    async issueInvitation(input) {
      return authority.service(
        {
          actorKind: input.organizationId === null ? "system" : "operator",
          userId: input.operatorUserId,
          organizationId: input.organizationId,
          isolation: "serializable"
        },
        async (client) => {
          const prior = await client.query(
            `select *
               from ss.customer_engagement_invitations
              where issued_by_operator_user_id = $1
                and issue_command_id = $2
              for update`,
            [input.operatorUserId, input.commandId]
          );
          const existing = one(
            prior,
            "ENGAGEMENT_INVITATION_UNAVAILABLE",
            "Customer engagement invitation is unavailable.",
            { optional: true }
          );
          if (existing) {
            invariant(
              existing.issue_request_digest === input.requestDigest,
              "ENGAGEMENT_IDEMPOTENCY_CONFLICT",
              "That idempotency key was already used for another invitation.",
              { status: 409 }
            );
            return publicInvitation(existing, true);
          }

          const capability = await client.query(
            `select ss.service_operator_has_capability(
               $1, 'service_case_manage', $2
             ) as authorized`,
            [input.operatorUserId, input.issuedAt]
          );
          invariant(
            capability.rows[0]?.authorized === true,
            "OPERATOR_ACCESS_REQUIRED",
            "Active customer engagement operator authority is required.",
            { status: 403 }
          );

          const policy = one(
            await client.query(
              `select id
                 from ss.billing_policies
                where effective_at <= $1
                  and (retired_at is null or retired_at > $1)
                order by effective_at desc, id desc
                limit 1
                for update`,
              [input.issuedAt]
            ),
            "ENGAGEMENT_BILLING_POLICY_REQUIRED",
            "The project billing lifecycle policy is unavailable."
          );

          let accountMode;
          let customerUserId;
          let organizationId;
          let organizationName;
          let customerName;
          let sourceOrganizationId = null;
          let sourceDeliveryDigest = null;

          if (input.organizationId === null) {
            invariant(
              input.provenance === "direct_custom_inquiry",
              "INVALID_ENGAGEMENT_INPUT",
              "An assessment successor must bind its existing organization.",
              { status: 400 }
            );
            const collision = await client.query(
              `select 1 from auth.users
                where lower(email) = $1
                limit 1`,
              [input.customerEmail]
            );
            invariant(
              collision.rowCount === 0,
              "ENGAGEMENT_ACCOUNT_ALREADY_EXISTS",
              "Bind an existing customer organization for this email.",
              { status: 409 }
            );
            accountMode = "new_account";
            customerUserId = input.accountCandidateUserId;
            organizationId = input.reservedOrganizationId;
            organizationName = input.organizationName;
            customerName = input.customerName;
          } else {
            const account = one(
              await client.query(
                `select
                   account.id,
                   profile.display_name,
                   organization.name as organization_name
                 from auth.users account
                 join ss.hosted_account_profiles profile
                   on profile.user_id = account.id
                 join ss.organizations organization
                   on organization.id = $1
                 join ss.organization_memberships membership
                   on membership.organization_id = organization.id
                  and membership.user_id = account.id
                where lower(account.email) = $2
                  and account.disabled_at is null
                  and profile.state = 'active'
                  and organization.state = 'active'
                  and membership.state = 'active'
                  and membership.role in ('owner', 'admin')
                for update of account, profile, organization, membership`,
                [input.organizationId, input.customerEmail]
              ),
              "ENGAGEMENT_CUSTOMER_AUTHORITY_REQUIRED",
              "The existing customer organization binding is unavailable."
            );
            invariant(
              account.display_name === input.customerName,
              "ENGAGEMENT_CUSTOMER_AUTHORITY_REQUIRED",
              "The existing customer identity does not match the invitation.",
              { status: 409 }
            );
            accountMode = "existing_account";
            customerUserId = account.id;
            organizationId = input.organizationId;
            organizationName = account.organization_name;
            customerName = account.display_name;
          }

          if (input.provenance === "delivered_assessment_successor") {
            const report = one(
              await client.query(
                `select customer_user_id, delivery_digest
                   from ss.service_assessment_reports
                  where organization_id = $1 and id = $2
                  for share`,
                [organizationId, input.sourceAssessmentReportId]
              ),
              "ENGAGEMENT_ASSESSMENT_PROVENANCE_REQUIRED",
              "The delivered assessment provenance is unavailable."
            );
            invariant(
              report.customer_user_id === customerUserId,
              "ENGAGEMENT_ASSESSMENT_PROVENANCE_REQUIRED",
              "The delivered assessment does not belong to this customer.",
              { status: 409 }
            );
            sourceOrganizationId = organizationId;
            sourceDeliveryDigest = report.delivery_digest;
          }

          const inserted = one(
            await client.query(
              `insert into ss.customer_engagement_invitations (
                 id, issue_command_id, issued_by_operator_user_id,
                 provenance, account_mode, reserved_customer_user_id,
                 reserved_organization_id, reserved_project_id,
                 customer_email, customer_name, organization_name,
                 project_name, site_kind, external_site_url,
                 external_site_hostname, source_organization_id,
                 source_assessment_report_id,
                 source_assessment_delivery_digest, billing_policy_id,
                 legal_acceptance_schema, legal_authority_digest,
                 token_digest, issue_request_digest, issued_at, expires_at,
                 state, created_at
               ) values (
                 $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
                 $23, $24, $25, 'active', $24
               ) returning *`,
              [
                input.invitationId,
                input.commandId,
                input.operatorUserId,
                input.provenance,
                accountMode,
                customerUserId,
                organizationId,
                input.reservedProjectId,
                input.customerEmail,
                customerName,
                organizationName,
                input.projectName,
                input.site.kind,
                input.site.publicUrl,
                input.site.hostname,
                sourceOrganizationId,
                input.sourceAssessmentReportId,
                sourceDeliveryDigest,
                policy.id,
                input.legalAcceptanceSchema,
                input.legalAuthorityDigest,
                input.tokenDigest,
                input.requestDigest,
                input.issuedAt,
                input.expiresAt
              ]
            ),
            "ENGAGEMENT_INVITATION_UNAVAILABLE",
            "Customer engagement invitation is unavailable."
          );
          await client.query(
            `select ss.write_audit_event(
               $1, null, 'operator', $2,
               'customer_engagement.invitation_issued',
               'customer_engagement_invitation', $3, null,
               jsonb_build_object(
                 'issueRequestDigest', $4::text,
                 'legalAuthorityDigest', $5::text,
                 'provenance', $6::text
               )
             )`,
            [
              accountMode === "existing_account" ? organizationId : null,
              input.operatorUserId,
              input.invitationId,
              input.requestDigest,
              input.legalAuthorityDigest,
              input.provenance
            ]
          );
          return publicInvitation(inserted, false);
        }
      );
    },

    async claimInvitation(input) {
      const claimedAt = iso(clock());
      const sessionTokenDigest = sha256(input.sessionToken);
      const claimTarget = await authority.service(
        { readOnly: true },
        async (client) => one(
          await client.query(
            `select reserved_customer_user_id, reserved_organization_id
               from ss.customer_engagement_invitations
              where token_digest = $1`,
            [input.tokenDigest]
          ),
          "ENGAGEMENT_CLAIM_UNAVAILABLE",
          "Customer engagement claim is unavailable."
        )
      );
      return authority.service(
        {
          actorKind: "customer",
          userId: claimTarget.reserved_customer_user_id,
          organizationId: claimTarget.reserved_organization_id,
          isolation: "serializable"
        },
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`sitesourcery.engagement-claim:${input.tokenDigest}`]
          );
          const invitation = one(
            await client.query(
              `select *
                 from ss.customer_engagement_invitations
                where token_digest = $1
                for update`,
              [input.tokenDigest]
            ),
            "ENGAGEMENT_CLAIM_UNAVAILABLE",
            "Customer engagement claim is unavailable."
          );

          if (invitation.state === "claimed") {
            if (
              invitation.claim_command_id !== input.claimCommandId ||
              invitation.claim_request_digest !== input.claimRequestDigest
            ) {
              throw claimFailure();
            }
            return replayClaim(
              client,
              invitation,
              sessionTokenDigest,
              claimedAt
            );
          }
          if (
            invitation.state !== "active" ||
            Date.parse(invitation.expires_at) <= Date.parse(claimedAt) ||
            invitation.legal_acceptance_schema !==
              input.legalAcceptance.schema ||
            invitation.legal_authority_digest !==
              input.legalAcceptance.authorityDigest
          ) {
            throw claimFailure();
          }

          const policy = await client.query(
            `select 1 from ss.billing_policies
              where id = $1
                and effective_at <= $2
                and (retired_at is null or retired_at > $2)
              for update`,
            [invitation.billing_policy_id, claimedAt]
          );
          if (policy.rowCount !== 1) throw claimFailure();
          const documents = await exactLegalDocuments(
            client,
            input.legalAcceptance
          );

          if (invitation.account_mode === "new_account") {
            const passwordPhc = await hashPasswordWithPepper(input.password, {
              pepper,
              pepperVersion,
              randomBytes
            });
            const created = await client.query(
              `insert into auth.users (id, email, created_at, updated_at)
               values ($1, $2, $3, $3)
               on conflict do nothing returning id`,
              [
                invitation.reserved_customer_user_id,
                invitation.customer_email,
                claimedAt
              ]
            );
            if (created.rowCount !== 1) throw claimFailure();
            await client.query(
              `insert into ss.hosted_account_profiles (
                 user_id, display_name, state, created_at, updated_at
               ) values ($1, $2, 'active', $3, $3)`,
              [
                invitation.reserved_customer_user_id,
                invitation.customer_name,
                claimedAt
              ]
            );
            await client.query(
              `insert into ss.hosted_password_credentials (
                 user_id, password_phc, pepper_version, revision,
                 created_at, updated_at, rotated_at
               ) values ($1, $2, $3, 1, $4, $4, $4)`,
              [
                invitation.reserved_customer_user_id,
                passwordPhc,
                pepperVersion,
                claimedAt
              ]
            );
            await client.query(
              `insert into ss.organizations (
                 id, created_by_user_id, name, state, created_at, updated_at
               ) values ($1, $2, $3, 'active', $4, $4)`,
              [
                invitation.reserved_organization_id,
                invitation.reserved_customer_user_id,
                invitation.organization_name,
                claimedAt
              ]
            );
            await client.query(
              `insert into ss.organization_memberships (
                 organization_id, user_id, role, state, accepted_at,
                 created_at, updated_at
               ) values ($1, $2, 'owner', 'active', $3, $3, $3)`,
              [
                invitation.reserved_organization_id,
                invitation.reserved_customer_user_id,
                claimedAt
              ]
            );
          } else {
            const credential = one(
              await client.query(
                `select credential.password_phc
                   from auth.users account
                   join ss.hosted_account_profiles profile
                     on profile.user_id = account.id
                   join ss.hosted_password_credentials credential
                     on credential.user_id = account.id
                   join ss.organization_memberships membership
                     on membership.organization_id = $2
                    and membership.user_id = account.id
                  where account.id = $1
                    and lower(account.email) = $3
                    and account.disabled_at is null
                    and profile.state = 'active'
                    and membership.state = 'active'
                    and membership.role in ('owner', 'admin')
                  for update of account, profile, credential, membership`,
                [
                  invitation.reserved_customer_user_id,
                  invitation.reserved_organization_id,
                  invitation.customer_email
                ]
              ),
              "ENGAGEMENT_CLAIM_UNAVAILABLE",
              "Customer engagement claim is unavailable."
            );
            if (!(await verifyPasswordWithPepper(
              input.password,
              credential.password_phc,
              pepperFor
            ))) {
              throw claimFailure();
            }
          }

          const customerUserId = invitation.reserved_customer_user_id;
          const organizationId = invitation.reserved_organization_id;
          const projectId = invitation.reserved_project_id;
          const requestId = randomUUID();
          const receiptId = randomUUID();

          await client.query(
            `insert into ss.projects (
               id, organization_id, created_by_user_id, billing_policy_id,
               name, lifecycle, revision, created_at, updated_at
             ) values ($1, $2, $3, $4, $5, 'active', 1, $6, $6)`,
            [
              projectId,
              organizationId,
              customerUserId,
              invitation.billing_policy_id,
              invitation.project_name,
              claimedAt
            ]
          );
          await client.query(
            `insert into ss.project_legal_acceptance_receipts (
               id, organization_id, project_id, user_id, request_id,
               schema_version, acceptance_statement, authority_digest,
               user_agent_digest, accepted_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              receiptId,
              organizationId,
              projectId,
              customerUserId,
              requestId,
              input.legalAcceptance.schema,
              input.legalAcceptance.acceptanceStatement,
              input.legalAcceptance.authorityDigest,
              input.userAgentDigest,
              claimedAt
            ]
          );
          for (const document of documents) {
            const acceptanceId = randomUUID();
            await client.query(
              `insert into ss.term_acceptances (
                 id, organization_id, project_id, user_id, document_id,
                 accepted_at, request_id, legal_receipt_id
               ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                acceptanceId,
                organizationId,
                projectId,
                customerUserId,
                document.id,
                claimedAt,
                requestId,
                receiptId
              ]
            );
            const legalDocument = input.legalAcceptance.documents.find(
              (candidate) =>
                legalAuthority.documentBindings.find(
                  (binding) => binding.id === document.id
                )?.kind === candidate.kind
            );
            await client.query(
              `insert into ss.project_required_terms (
                 organization_id, project_id, kind, acceptance_id
               ) values ($1, $2, $3, $4)`,
              [organizationId, projectId, legalDocument.kind, acceptanceId]
            );
          }

          await client.query(
            `insert into ss.project_safety_projection (
               organization_id, project_id, state, updated_at
             ) values ($1, $2, 'clear', $3)`,
            [organizationId, projectId, claimedAt]
          );
          await client.query(
            `insert into ss.project_access_projection (
               organization_id, project_id, visibility,
               current_credential_id, updated_at
             ) values ($1, $2, 'public', null, $3)`,
            [organizationId, projectId, claimedAt]
          );
          await client.query(
            `insert into ss.project_drafts (
               organization_id, project_id, raw_facts, revision,
               updated_by_user_id, updated_at
             ) values ($1, $2, '{}'::jsonb, 1, $3, $4)`,
            [organizationId, projectId, customerUserId, claimedAt]
          );
          await client.query(
            `insert into ss.project_address_projection (
               organization_id, project_id, current_address_id, updated_at
             ) values ($1, $2, null, $3)`,
            [organizationId, projectId, claimedAt]
          );
          await client.query(
            `insert into ss.project_serving_projection (
               organization_id, project_id, state, resume_state, updated_at
             ) values ($1, $2, 'unpublished', 'unpublished', $3)`,
            [organizationId, projectId, claimedAt]
          );
          await client.query(
            `insert into ss.service_project_profiles (
               organization_id, project_id, customer_user_id, origin,
               observed_hostname, observed_at, platform_family,
               ownership_state, takeover_required, takeover_state,
               supportability_state, delegated_access_state,
               revision, created_at, updated_at
             ) values (
               $1, $2, $3, $4, $5, $6, 'unknown',
               'customer_stated', $7, $8, $9, 'not_requested', 1, $10, $10
             )`,
            [
              organizationId,
              projectId,
              customerUserId,
              invitation.site_kind === "new_site"
                ? "sitesourcery_custom"
                : "external",
              invitation.external_site_hostname,
              invitation.site_kind === "external_site" ? claimedAt : null,
              invitation.site_kind === "external_site",
              invitation.site_kind === "external_site"
                ? "review_required"
                : "not_required",
              invitation.site_kind === "external_site"
                ? "not_reviewed"
                : "not_applicable",
              claimedAt
            ]
          );

          const claimReceiptDigest = sha256(canonicalJson({
            claimCommandId: input.claimCommandId,
            claimRequestDigest: input.claimRequestDigest,
            claimedAt,
            customerUserId,
            invitationId: invitation.id,
            legalAuthorityDigest: invitation.legal_authority_digest,
            organizationId,
            projectId,
            requestId
          }));
          const claimed = await client.query(
            `update ss.customer_engagement_invitations
                set state = 'claimed',
                    claim_command_id = $2,
                    claim_request_id = $3,
                    claim_request_digest = $4,
                    claimed_by_user_id = $5,
                    claimed_at = $6,
                    claim_receipt_digest = $7
              where id = $1 and state = 'active'`,
            [
              invitation.id,
              input.claimCommandId,
              requestId,
              input.claimRequestDigest,
              customerUserId,
              claimedAt,
              claimReceiptDigest
            ]
          );
          if (claimed.rowCount !== 1) throw claimFailure();

          const engagementDigest = sha256(canonicalJson({
            claimReceiptDigest,
            invitationId: invitation.id,
            legalReceiptId: receiptId,
            provenance: invitation.provenance,
            sourceAssessmentDeliveryDigest:
              invitation.source_assessment_delivery_digest
          }));
          await client.query(
            `insert into ss.customer_engagements (
               id, invitation_id, organization_id, project_id,
               customer_user_id, provenance, site_kind, external_site_url,
               external_site_hostname, source_organization_id,
               source_assessment_report_id,
               source_assessment_delivery_digest,
               created_by_operator_user_id, project_legal_receipt_id,
               legal_authority_digest, claim_request_id, engagement_digest,
               claimed_at, created_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17, $18, $18
             )`,
            [
              input.engagementId,
              invitation.id,
              organizationId,
              projectId,
              customerUserId,
              invitation.provenance,
              invitation.site_kind,
              invitation.external_site_url,
              invitation.external_site_hostname,
              invitation.source_organization_id,
              invitation.source_assessment_report_id,
              invitation.source_assessment_delivery_digest,
              invitation.issued_by_operator_user_id,
              receiptId,
              invitation.legal_authority_digest,
              requestId,
              engagementDigest,
              claimedAt
            ]
          );

          const sessionExpiresAt = new Date(
            Date.parse(claimedAt) + sessionTtlMs
          ).toISOString();
          await client.query(
            `insert into ss.hosted_sessions (
               id, user_id, token_digest, created_at, expires_at,
               reauthenticated_at, rotation
             ) values ($1, $2, $3, $4, $5, $4, 1)`,
            [
              input.sessionId,
              customerUserId,
              sessionTokenDigest,
              claimedAt,
              sessionExpiresAt
            ]
          );
          await client.query(
            `select ss.write_audit_event(
               $1, $2, 'user', $3,
               'customer_engagement.claimed', 'customer_engagement',
               $4, $5,
               jsonb_build_object(
                 'engagementDigest', $6::text,
                 'invitationId', $7::text,
                 'legalAuthorityDigest', $8::text,
                 'provenance', $9::text
               )
             )`,
            [
              organizationId,
              projectId,
              customerUserId,
              input.engagementId,
              requestId,
              engagementDigest,
              invitation.id,
              invitation.legal_authority_digest,
              invitation.provenance
            ]
          );

          return publicClaim(one(
            await client.query(
              `select
                 engagement.id as engagement_id,
                 engagement.invitation_id,
                 engagement.organization_id,
                 engagement.project_id,
                 engagement.project_legal_receipt_id,
                 engagement.legal_authority_digest,
                 engagement.provenance,
                 engagement.source_assessment_report_id,
                 engagement.claimed_at,
                 account.id as user_id,
                 account.email,
                 account.created_at as user_created_at,
                 profile.display_name,
                 organization.name as organization_name,
                 organization.state as organization_state,
                 organization.created_at as organization_created_at,
                 membership.role as organization_role,
                 project.name as project_name,
                 project.lifecycle as project_lifecycle,
                 project.created_at as project_created_at
               from ss.customer_engagements engagement
               join auth.users account
                 on account.id = engagement.customer_user_id
               join ss.hosted_account_profiles profile
                 on profile.user_id = account.id
               join ss.organizations organization
                 on organization.id = engagement.organization_id
               join ss.organization_memberships membership
                 on membership.organization_id = organization.id
                and membership.user_id = account.id
               join ss.projects project
                 on project.organization_id = engagement.organization_id
                and project.id = engagement.project_id
              where engagement.id = $1`,
              [input.engagementId]
            ),
            "ENGAGEMENT_CLAIM_UNAVAILABLE",
            "Customer engagement claim is unavailable."
          ), false);
        }
      );
    }
  });
}
