import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import { createPostgresIdentityBridge } from "../identity-postgres.mjs";
import {
  createDurableRecoveryMailPort,
  createDurableRegistrationMailPort
} from "../mail-delivery-bridge.mjs";
import { createMailLifecycle } from "../mail-lifecycle.mjs";
import {
  createPostgresMailLifecycleRepository
} from "../mail-lifecycle-postgres.mjs";
import { createCanonicalPostgresService } from "../postgres-service.mjs";
import {
  createProductionRecoveryMailPort
} from "../recovery-mail-port.mjs";
import {
  createProductionRegistrationMailPort
} from "../registration-mail-port.mjs";
import {
  createCanonicalPostgresAuthority
} from "../repository-postgres.mjs";

const { Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_MAIL_FINAL_TEST_URL ?? null;

function tokenFromUrl(value, prefix) {
  return decodeURIComponent(
    new URL(value).hash.slice(prefix.length)
  );
}

function unusedServiceDependencies() {
  const outsideScope = () => {
    throw new Error("MAIL-FINAL PostgreSQL proof crossed its identity scope.");
  };
  return {
    compiler: {
      revision: "mail-final-postgres-proof-v1",
      compile: outsideScope
    },
    catalogPort: { current: outsideScope },
    publicationPort: {
      request: outsideScope,
      rollback: outsideScope,
      unpublish: outsideScope
    },
    exportStore: {
      key: outsideScope,
      put: outsideScope,
      get: outsideScope,
      delete: outsideScope
    }
  };
}

test(
  "PostgreSQL provider acceptance needs exact token possession before identity delivery",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 4
    });
    const now = new Date().toISOString();
    const clock = { now: () => now };
    const registrationSends = [];
    const recoverySends = [];

    try {
      const authority = createCanonicalPostgresAuthority({ pool });
      assert.equal((await authority.assertReady()).ready, true);

      const lifecycle = createMailLifecycle({
        repository: createPostgresMailLifecycleRepository({ authority }),
        clock
      });
      assert.deepEqual(await lifecycle.readiness(), {
        ready: true,
        verified: true,
        kind: "durable-mail-lifecycle-postgres",
        code: null,
        providerEffects: false
      });

      const providerReadiness = async () => ({
        ready: true,
        verified: true,
        provider: "mail-final-fixture"
      });
      const registrationMailPort =
        createDurableRegistrationMailPort({
          lifecycle,
          providerPort: createProductionRegistrationMailPort({
            clock,
            transport: {
              readiness: providerReadiness,
              async sendRegistration(input) {
                registrationSends.push(input);
                return {
                  accepted: true,
                  provider: "mail-final-fixture",
                  providerMessageId:
                    `registration-${registrationSends.length}`,
                  idempotencyKey: input.idempotencyKey,
                  payloadDigest: input.payloadDigest,
                  acceptedAt: now
                };
              }
            }
          }),
          clock
        });
      const recoveryMailPort = createDurableRecoveryMailPort({
        lifecycle,
        providerPort: createProductionRecoveryMailPort({
          clock,
          transport: {
            readiness: providerReadiness,
            async sendRecovery(input) {
              recoverySends.push(input);
              return {
                accepted: true,
                provider: "mail-final-fixture",
                providerMessageId:
                  `recovery-${recoverySends.length}`,
                idempotencyKey: input.idempotencyKey,
                payloadDigest: input.payloadDigest,
                acceptedAt: now
              };
            }
          }
        }),
        clock
      });
      assert.equal((await registrationMailPort.readiness()).ready, true);
      assert.equal((await recoveryMailPort.readiness()).ready, true);

      const identity = createPostgresIdentityBridge({
        pool,
        authority,
        pepper: randomBytes(32),
        pepperVersion: "mail-final-postgres-proof-v1",
        clock: () => new Date(now),
        registrationMailPort
      });
      const service = createCanonicalPostgresService({
        authority,
        identity,
        recoveryMailPort,
        clock,
        ...unusedServiceDependencies()
      });

      const email = `mail-final-${randomUUID()}@example.test`;
      const registrationCommand = `register-${randomUUID()}`;
      const activationCommand = `activate-${randomUUID()}`;
      const registrationResponse = await service.register(
        {
          name: "Mail Final Proof",
          organizationName: "Mail Final Proof Organization",
          email,
          password: "correct horse battery staple final",
          commandId: registrationCommand
        },
        { clientAddress: "127.0.0.1" }
      );
      assert.equal(registrationResponse.emailSent, true);
      assert.equal(registrationSends.length, 1);

      const acceptedRegistration = (
        await pool.query(
          `select
             request.id, request.state, request.mail_delivery_id,
             request.provider_accepted_at, request.delivered_at,
             request.possession_proven_at, mail.state as mail_state,
             (select count(*)::integer
                from auth.users
               where lower(email) = $1) as account_count,
             (select count(*)::integer
                from ss.hosted_sessions session
                join auth.users account on account.id = session.user_id
               where lower(account.email) = $1) as session_count
           from ss.hosted_registration_requests request
           join ss.hosted_mail_deliveries mail
             on mail.id = request.mail_delivery_id
          where request.command_id = $2`,
          [email, registrationCommand]
        )
      ).rows[0];
      assert.equal(acceptedRegistration.state, "provider_accepted");
      assert.equal(acceptedRegistration.mail_state, "provider_accepted");
      assert.ok(acceptedRegistration.mail_delivery_id);
      assert.ok(acceptedRegistration.provider_accepted_at);
      assert.equal(acceptedRegistration.delivered_at, null);
      assert.equal(acceptedRegistration.possession_proven_at, null);
      assert.equal(acceptedRegistration.account_count, 0);
      assert.equal(acceptedRegistration.session_count, 0);

      await assert.rejects(
        pool.query(
          `update ss.hosted_registration_requests
              set state = 'delivered', delivered_at = $2
            where id = $1`,
          [acceptedRegistration.id, now]
        ),
        (error) => error?.code === "23514"
      );
      await assert.rejects(
        service.completeRegistration({
          token: "x".repeat(43),
          commandId: `wrong-${randomUUID()}`
        }),
        (error) => error?.code === "REGISTRATION_TOKEN_INVALID"
      );

      const registrationToken = tokenFromUrl(
        registrationSends[0].verificationUrl,
        "#verify-registration="
      );
      const activated = await service.completeRegistration({
        token: registrationToken,
        commandId: activationCommand
      });
      assert.equal(activated.replayed, false);
      assert.equal(
        (
          await service.completeRegistration({
            token: registrationToken,
            commandId: activationCommand
          })
        ).replayed,
        true
      );
      await assert.rejects(
        service.completeRegistration({
          token: registrationToken,
          commandId: `foreign-${randomUUID()}`
        }),
        (error) => error?.code === "REGISTRATION_ALREADY_COMPLETED"
      );

      const activatedRegistration = (
        await pool.query(
          `select
             request.state, request.delivered_at,
             request.possession_evidence_digest,
             request.possession_proven_at, mail.state as mail_state,
             (select count(*)::integer
                from auth.users
               where lower(email) = $1) as account_count,
             (select count(*)::integer
                from ss.hosted_sessions session
                join auth.users account on account.id = session.user_id
               where lower(account.email) = $1) as session_count
           from ss.hosted_registration_requests request
           join ss.hosted_mail_deliveries mail
             on mail.id = request.mail_delivery_id
          where request.command_id = $2`,
          [email, registrationCommand]
        )
      ).rows[0];
      assert.equal(activatedRegistration.state, "activated");
      assert.equal(activatedRegistration.mail_state, "provider_accepted");
      assert.ok(activatedRegistration.possession_evidence_digest);
      assert.equal(
        activatedRegistration.delivered_at.toISOString(),
        activatedRegistration.possession_proven_at.toISOString()
      );
      assert.equal(activatedRegistration.account_count, 1);
      assert.equal(activatedRegistration.session_count, 1);

      const firstRecoveryCommand = `recover-a-${randomUUID()}`;
      const firstRecoveryResponse = await service.requestRecovery(
        { email, commandId: firstRecoveryCommand },
        { clientAddress: "127.0.0.1" }
      );
      assert.deepEqual(firstRecoveryResponse, {
        accepted: true,
        delivery: "email",
        emailSent: true
      });
      assert.equal(recoverySends.length, 1);
      const firstRecovery = (
        await pool.query(
          `select
             request.id, request.state, request.recovery_token_id,
             request.mail_delivery_id, request.provider_accepted_at,
             request.delivered_at, request.possession_proven_at,
             token.used_at, mail.state as mail_state
           from ss.hosted_recovery_delivery_requests request
           join ss.hosted_recovery_tokens token
             on token.id = request.recovery_token_id
           join ss.hosted_mail_deliveries mail
             on mail.id = request.mail_delivery_id
          where request.command_id = $1`,
          [firstRecoveryCommand]
        )
      ).rows[0];
      assert.equal(firstRecovery.state, "provider_accepted");
      assert.equal(firstRecovery.mail_state, "provider_accepted");
      assert.ok(firstRecovery.recovery_token_id);
      assert.ok(firstRecovery.mail_delivery_id);
      assert.ok(firstRecovery.provider_accepted_at);
      assert.equal(firstRecovery.delivered_at, null);
      assert.equal(firstRecovery.possession_proven_at, null);
      assert.equal(firstRecovery.used_at, null);

      await assert.rejects(
        pool.query(
          `update ss.hosted_recovery_delivery_requests
              set state = 'delivered', delivered_at = $2
            where id = $1`,
          [firstRecovery.id, now]
        ),
        (error) => error?.code === "23514"
      );

      const secondRecoveryCommand = `recover-b-${randomUUID()}`;
      await service.requestRecovery(
        { email, commandId: secondRecoveryCommand },
        { clientAddress: "127.0.0.1" }
      );
      assert.equal(recoverySends.length, 2);
      const firstRecoveryToken = tokenFromUrl(
        recoverySends[0].recoveryUrl,
        "#recovery="
      );
      await assert.rejects(
        service.completeRecovery({
          token: firstRecoveryToken,
          password: "superseded recovery must not rotate"
        }),
        (error) => error?.code === "RECOVERY_TOKEN_INVALID"
      );
      assert.ok(
        (
          await pool.query(
            `select used_at
               from ss.hosted_recovery_tokens
              where id = $1`,
            [firstRecovery.recovery_token_id]
          )
        ).rows[0].used_at
      );

      const secondRecoveryToken = tokenFromUrl(
        recoverySends[1].recoveryUrl,
        "#recovery="
      );
      assert.deepEqual(
        await service.completeRecovery({
          token: secondRecoveryToken,
          password: "rotated correct horse battery staple final"
        }),
        { completed: true }
      );
      const completedRecovery = (
        await pool.query(
          `select
             request.state, request.delivered_at,
             request.possession_evidence_digest,
             request.possession_proven_at,
             request.mail_delivery_id, mail.state as mail_state,
             token.used_at,
             credential.revision as credential_revision,
             count(session.id)::integer as session_count,
             count(session.id) filter (
               where session.revoked_at is not null
             )::integer as revoked_session_count
           from ss.hosted_recovery_delivery_requests request
           join ss.hosted_recovery_tokens token
             on token.id = request.recovery_token_id
           join ss.hosted_mail_deliveries mail
             on mail.id = request.mail_delivery_id
           join ss.hosted_password_credentials credential
             on credential.user_id = token.user_id
           left join ss.hosted_sessions session
             on session.user_id = token.user_id
          where request.command_id = $1
          group by request.id, mail.state, token.used_at,
                   credential.revision`,
          [secondRecoveryCommand]
        )
      ).rows[0];
      assert.equal(completedRecovery.state, "delivered");
      assert.equal(completedRecovery.mail_state, "provider_accepted");
      assert.ok(completedRecovery.possession_evidence_digest);
      assert.equal(
        completedRecovery.delivered_at.toISOString(),
        completedRecovery.possession_proven_at.toISOString()
      );
      assert.equal(
        completedRecovery.used_at.toISOString(),
        completedRecovery.possession_proven_at.toISOString()
      );
      assert.equal(Number(completedRecovery.credential_revision), 2);
      assert.equal(completedRecovery.session_count, 1);
      assert.equal(completedRecovery.revoked_session_count, 1);
      await assert.rejects(
        service.completeRecovery({
          token: secondRecoveryToken,
          password: "replayed recovery must not rotate"
        }),
        (error) => error?.code === "RECOVERY_TOKEN_INVALID"
      );

      const unknownCommand = `recover-unknown-${randomUUID()}`;
      const unknownEmail = `unknown-${randomUUID()}@example.test`;
      const unknownResponse = await service.requestRecovery(
        {
          email: unknownEmail,
          commandId: unknownCommand
        },
        { clientAddress: "127.0.0.1" }
      );
      assert.deepEqual(unknownResponse, firstRecoveryResponse);
      assert.deepEqual(
        await service.requestRecovery(
          {
            email: unknownEmail,
            commandId: unknownCommand
          },
          { clientAddress: "127.0.0.1" }
        ),
        unknownResponse
      );
      await assert.rejects(
        service.requestRecovery(
          {
            email: `other-${randomUUID()}@example.test`,
            commandId: unknownCommand
          },
          { clientAddress: "127.0.0.1" }
        ),
        (error) => error?.code === "RECOVERY_IDEMPOTENCY_CONFLICT"
      );
      assert.equal(recoverySends.length, 2);
      assert.deepEqual(
        (
          await pool.query(
            `select
               state, recovery_token_id, mail_delivery_id,
               provider_receipt_id, possession_proven_at
             from ss.hosted_recovery_delivery_requests
            where command_id = $1`,
            [unknownCommand]
          )
        ).rows[0],
        {
          state: "recipient_unresolved",
          recovery_token_id: null,
          mail_delivery_id: null,
          provider_receipt_id: null,
          possession_proven_at: null
        }
      );

      assert.deepEqual(
        (
          await pool.query(
            `select
               bool_and(c.relrowsecurity) as rls_enabled,
               bool_and(c.relforcerowsecurity) as rls_forced,
               not bool_or(has_table_privilege(
                 'anon', format('%I.%I', n.nspname, c.relname), 'SELECT'
               )) as anon_denied,
               not bool_or(has_table_privilege(
                 'authenticated', format('%I.%I', n.nspname, c.relname), 'SELECT'
               )) as authenticated_denied,
               bool_and(has_table_privilege(
                 'service_role', format('%I.%I', n.nspname, c.relname),
                 'SELECT,INSERT,UPDATE,DELETE'
               )) as service_allowed
             from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'ss'
              and c.relname = any($1::text[])`,
            [[
              "hosted_registration_requests",
              "hosted_recovery_delivery_requests"
            ]]
          )
        ).rows[0],
        {
          rls_enabled: true,
          rls_forced: true,
          anon_denied: true,
          authenticated_denied: true,
          service_allowed: true
        }
      );
      const triggerDefinitions = (
        await pool.query(
          `select tgname, pg_get_triggerdef(trigger.oid) as definition
             from pg_trigger trigger
            where trigger.tgrelid = any($1::regclass[])
              and not trigger.tgisinternal
            order by tgname`,
          [[
            "ss.hosted_registration_requests",
            "ss.hosted_recovery_delivery_requests"
          ]]
        )
      ).rows;
      assert.equal(triggerDefinitions.length, 2);
      const triggerByName = Object.fromEntries(
        triggerDefinitions.map((row) => [row.tgname, row.definition])
      );
      assert.match(
        triggerByName.hosted_registration_delivery_acceptance_guard,
        /BEFORE INSERT OR UPDATE/u
      );
      assert.match(
        triggerByName.hosted_recovery_delivery_requests_transition,
        /BEFORE UPDATE/u
      );
    } finally {
      await pool.end();
    }
  }
);
