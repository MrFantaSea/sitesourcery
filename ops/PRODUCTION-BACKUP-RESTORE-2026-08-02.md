# Production rehearsal backup and restore — 2026-08-02

## Result

The Dell/HQ loopback-only production rehearsal produced an encrypted,
off-machine backup on Zen and Zen restored that exact attempt into a fresh,
Unix-socket-only PostgreSQL cluster and a fresh app-state root. The successful
restore reproduced all database invariants and all 607 app-state entries, then
the disposable plaintext database cluster and app-state roots were removed.

This closes the production-rehearsal backup/restore proof. It does not authorize
public ingress, DNS changes, Caddy activation, Stripe, registrar effects,
publication, or an outbound monitoring adapter.

## Exact identities

| Boundary | Exact identity |
| --- | --- |
| Branch | `build/sitesourcery-v2-20260730` |
| Backup source/runtime release | `15cab8f4d220f9a5116b89c732daa6dc9fb19a17` |
| Successful restore tooling | `4f889a6410f60eedc5b02f480022107748a8b0e5` |
| Source failure domain | Dell runtime with HQ PostgreSQL |
| Encrypted destination and restore host | Zen |
| PostgreSQL | `16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)` |
| Node | `24.18.0` |
| age | `1.3.1` |

The restore-tooling branch ref matched on Mac, Dell, and GitHub before the
successful drill. Dell remained loopback-only throughout. Zen's restore
PostgreSQL service enforced `RestrictAddressFamilies=AF_UNIX`, used an
owner-only socket on port `55443`, and had no TCP listener.

## Canonical encrypted backup

- Attempt ID:
  `2026-08-02T014913439Z-0444653b-6b41-4465-b003-d819b9366c23`.
- Attempt manifest SHA-256:
  `c06f17b94dadc94e85d32e6640064372368d156592c78f987a2494b2334e344d`.
- Started: `2026-08-02T01:49:13.439Z`.
- Completed: `2026-08-02T01:49:46.109Z`.
- Capture duration: `32,670 ms`.
- Different-failure-domain marker digest:
  `2dc63155371f048f4617d90e3b1037b8c2419cf9905946d3e859861933005c0e`.

The reviewed source operations state was Stripe `held`, registration and
recovery mail `production`, and publication, domain runtime, and DNS `held`.
The backup process independently kept all provider egress held. Its quiesce
evidence names `sitesourcery-production.service`, records it inactive with zero
hosted database writers before and after capture, and binds snapshot
`production-rehearsal-20260802-014604` to fence digest
`cf00898c568c3af5c6c1592778cc993fe9b81c1fad6ce8ea37f8571eab3ef487`.

| Artifact | Encrypted bytes and SHA-256 | Verified plaintext |
| --- | --- | --- |
| PostgreSQL | `675273`; `7c2629357e2c6ee8291dba6edd551dc2375002d3e932e7f1758ba66e7dd643c3` | `dae2b768bd02728c104b71ad362214e83cd9fc497ce3e8c451fe4f9d24db5836` |
| App state | `21560648`; `dad10724761468d3a769480bc2a4f54a84ebdcdaed92efd40cc5d02d313b15dd` | `535958bd6620ffc1153b7c8813c011b6689018cdb0c63aab9df85991dab54323` |

The app-state inventory tree is
`c208159042f561fae083a065a4f7e049cf7d1182a11d5cebef09447ac7e59423`.
It covers configuration metadata, private exports, tenant runtime control and
release state, and the symlink-free exact release snapshot. The PostgreSQL
manifest records 94 `ss` tables, v13/v14/v15 contracts, no `ss_hosted` shadow
schema, held domain procurement, canonical role properties, and zero rows in
organizations, projects, audit events, export requests, and the transactional
outbox.

## Clean-room restore

Preflight proved that the target database and app-state root did not exist,
that the three migration roles had the exact login/BYPASSRLS properties, that
data checksums were enabled, and that the backup manifest and both ciphertext
hashes still matched before decryption.

The first real restore under tooling commit
`84de99ca5393d7eb617633a733f6f4178fa1d7f3` failed closed with
`RESTORE_APP_STATE_INVARIANT_FAILED`. Its immutable failure report SHA-256 is
`d6995f882fa23c923e1f865bf504b7f8dd15e1e0aa49aaea22be3b2dafd84d38`.
Diagnosis found 607 expected and 607 restored paths, zero missing/extra files,
and zero content mismatches, but 591 permission mismatches because non-root GNU
tar applied the unit's `0077` mask. Commit `4f889a6` added
`--same-permissions` while retaining `--no-same-owner`, plus a regression test.
The failed database, app state, and immutable evidence were kept until the
cause was proven.

The retry used a new database and new app/evidence roots. It succeeded with:

- Restore ID: `5dcaef78-2e2a-46e8-b2a4-d693a695efa8`.
- Immutable success report SHA-256:
  `e5cf7001f7b697333f1e72ab9a4ddbff39ec4243a2f28a8ede2b076ada1785eb`.
- Internal restore interval: `2,260 ms`.
- End-to-end `systemctl start` wall time: `2,451 ms`.
- Fresh database: `sitesourcery_restore_20260802_02`.
- Database result: v13/v14/v15 present, shadow schema absent, held domain
  procurement, exact role grants, 94 tables, and all five recorded row counts
  equal to zero.
- App-state result: 607 expected entries, 607 actual entries, zero entry drift,
  and exact tree SHA-256
  `c208159042f561fae083a065a4f7e049cf7d1182a11d5cebef09447ac7e59423`.
- Restore execution: network exposure `none`; payments, registration mail,
  recovery mail, publication, registrar, DNS, and outbound-alert egress all
  `held`.
- Plaintext staging entries after completion: zero.

The backup was `26,786,503 ms` (7 h 26 min 26.503 s) old when the successful
restore began. That is the measured recovery-point age for this manual drill,
not an accepted production backup cadence. Owner acceptance of an RPO and the
scheduled backup/retention interval remain separate decisions.

## Cleanup and retained evidence

After independent database and app-tree verification, the dedicated restore
PostgreSQL service was stopped. Both disposable restored databases, the entire
dedicated PostgreSQL data directory, both decrypted app-state roots, and their
empty staging roots were removed. They are not recoverable from Zen as
plaintext.

The following remain owner-protected:

- the canonical encrypted backup and immutable backup ledger;
- the immutable failed-restore report and digest;
- the immutable successful-restore report and digest;
- the private age identity needed for future recovery drills; and
- static, disabled restore units and verified toolchains.

## Final repository gate

The final tree passed on Node 24.18.0: 264 core tests, 19 self-host tests, 108
hosted-service passes plus two expected PostgreSQL-environment skips, 32
operations tests, exact Pages and hosted artifacts, and 15 browser routes at
320, 390, and 1440 pixels.

## Still separate

The next operations work is live monitoring plus an owner-approved alert path,
followed by a successful delivered registration/recovery action-link proof.
Public ingress/TLS, DNS cutover, Stripe, Spaceship reseller authority and live
cost/debit proof, customer-domain DNS authority, and publication all remain
independent held work.
