# Current-release worker alignment

The public API runs1126f5b while the disabled FIN-010 worker still selects e8862278.
Its eleven-purpose configuration also uses an approval path under the home run
directory, which the current parser rejects. The installed1126f5b application
already implements all twelve purposes. This correction reuses that application;
it does not redeploy the website, change data, or activate jobs.

`worker-release-alignment.mjs` prepares an exact held environment and unit. It
requires the original generated FIN-010 unit and exact old environment inventory,
rejects changed held modes, validates configuration through the real parser,
and copies only eleven reviewed shared inputs from the current API environment.
API identity and provider keys are excluded. Historical FIN-010 generators and
origin receipts remain unchanged. The current generic template includes publication.

The corrected approval path is `/etc/sitesourcery/WORKERS_APPROVED`. The unit
checks both the new `/etc` hold and the existing home-run hold, plus both backup
fences. No approval file is created and no hold is removed by preparation or
alignment. Database pool allocation and per-purpose settings remain held.

## Installation and rollback

Use the exact private installation packet only after source review and focused
proof. Run `node ops/worker-release-alignment.mjs prepare ABSOLUTE_NEW_PRIVATE_DIR`
on Dell. It creates files exclusively and performs no service action. Never
print, commit, or hash the private environment; compare its bytes privately.

Confirm API release/source identity and unchanged predecessor unit/environment;
retain the original unit and environment privately. Install the new environment
as root:service-group0640 and the reviewed unit as its current service-user owner.
Reload only the user service manager. Keep the worker disabled/inactive and all
approval/hold markers unchanged. Verify exact loaded paths and run one isolated
held entrypoint with the real EnvironmentFile, no network access and read-only
filesystem access. It must exit0 and report twelve held purposes. Do not claim
that this held process proves live provider delivery or active job completion.

Rollback restores the retained original unit, reloads the user manager and
confirms disabled/inactive. Keep both versioned environments and all queue data.
No API restart, database restore or provider rollback is needed for this held
configuration-only change. Newer job activation must never roll back to the old
incompatible worker without a separately reviewed compatibility decision.

## Per-purpose activation prerequisites

All twelve are configured, supported by current source, and still held. Each
requires its own storage readiness and the exact approved purpose selection.
Existing composition/lifecycle tests are reused; this cohort adds only packaging
and the real held-process regression.

| Purpose | Remaining activation dependencies |
|---|---|
| export | Enabled export mode, private storage and actual export acceptance |
| cancellation | Approved Stripe adapter and cancellation/reconciliation acceptance |
| notification-mail | Reviewed renderer/registry, recipient authority, mail provider and delivery acceptance |
| alakazam-fulfillment | Released commercial policy, publication transport and fulfillment acceptance |
| alakazam-publication | Its explicit worker mode, released policy, publication transport and version/rollback acceptance |
| alakazam-retained-lifecycle | Released policy and retained-lifecycle approval |
| responder-fulfillment | Customer-specific Twilio registry, consent/material authority and real pilot acceptance |
| provider-reconciliation | Approved reconciliation mode; provider readback independently gated |
| responder-retention | Explicit destructive retention/policy and restore approval |
| project-lifecycle | Explicit lifecycle mode, approved deletion and verified unpublish/delete dependencies |
| domain-lifecycle | Digest-reviewed readback adapter and lifecycle authority |
| care-lifecycle | Approved monthly-period lifecycle mode and service acceptance |

The supervisor requires every selected purpose ready before starting any loop.
Activation should select only ready purposes in canonical order, not all twelve
at once. Customer/service acceptance remains separate from this completed
release alignment. Independent monitoring stays outside the worker process.
