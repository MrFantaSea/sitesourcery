# FIN-016 plain-language website release

State: protected-proof input plus deterministic copy-only cutover control; no
effect adapter

## What changes

FIN-016 replaces the installed `e74546a...` website/runtime tree with verified
candidate `1126f5b...`. The customer-facing text on all 21 non-legal public
routes becomes direct, plain English. Legal V7 is byte-for-byte unchanged.

This is not a database release. The predecessor and successor both contain the
same 102 migrations, latest migration
`202608310149_hosted_joint_legal_v7_authority.sql`, migration manifest
`c6e7b001...`, 299-table schema, and Legal V7 authority. The migration delta is
exactly empty. No `psql`, migration runner, schema write, or database repair is
part of this release.

## Exact proof

- Candidate commit/tree: `1126f5bf4993887e4a41571e9671e2fa20e1f136` /
  `4afbf2ac2bf6f33a028ea4f90de9d2414548dcbf`.
- Held workflow commit/tree: `bc5f56b7466e7e8cbaa0bab37a5da6fa90d4cf50` /
  `0af58b412880d518abe597ad75158328961a9352`.
- Successor input digest: `615d5fa25cc12d6d83665706635854d59316910f8f179e898e679c2832e7ecde`.
- Held CI final-receipt digest:
  `8870e564b300ad095f171ff672eecf908aec1b8477a578a5123b5a5c4d8d6a7a`.
- Held CI run: `33576768242`, attempt `1`.
- Candidate origin seal:
  `c1d820dd4f7780e991b196d168bf9e454c318f29a86cc9339878697e618fc2be`.
- Installed rollback commit/tree: `e74546a830649ac82a22463e4c08ea29e7edbc9c` /
  `c5a8c673a5a92d855153e4c52eab8414dda1ffd9`.

`ops/fin016-copy-release.mjs` also requires the protected commit and tree that
contain the production control itself. Those values are supplied only after
protected review and are verified against a clean exact checkout before a
bundle can be created.

## Authority boundary

The owner's September 1 instruction authorizes the safe plain-language release
after its exact checks pass. At action time that permits only:

- staging a new immutable release root and eight-file runtime bundle;
- selecting the candidate runtime/static services;
- making the already-reviewed plain-language pages public; and
- returning to the exact predecessor selection if candidate proof fails.

It does not permit a database mutation, new checkout or charge, provider
mutation, Twilio activation, Domains purchase or DNS change, Alakazam
publication, customer message or data mutation, legal acceptance, worker
activation, or retirement of rollback material.

The existing production-approved registration/recovery mail and Download-only
Stripe authority are preserved without widening. All Twilio environment modes,
both Alakazam modes, all Custom payment modes, Resend webhook execution,
publication, and the worker remain held. No new provider registry or secret may
enter the environment.

## Required action-time evidence

The cutover control is valid for at most 30 minutes. Before producing it,
re-read and record:

1. exact GitHub, Mac, and Dell protected commit/tree identity;
2. public `/live` and `/ready` success on installed `e74546a...`;
3. 102 migrations, 299 tables, matrix v2, 20 capability rows, six processes,
   `externalEffects=false`, and disabled worker;
4. active runtime, static, origin, tunnel, database-tunnel, monitor timer, and
   backup timer;
5. a paired encrypted Dell-to-Zen backup completed within one hour, matching
   hashes, clean-recovery verification, no retained plaintext, and provider
   egress held; and
6. the retained `e74546a...` release, environment, units, evidence, and paired
   restore path.

The prepared bundle must be no more than one hour old. Its `hosted.env` is
validated by exact byte comparison but has no recorded digest, byte count, or
secret value. The other seven files have exact SHA-256 evidence.

## Cutover order

1. Build `_hosted` and stage `1126f5b...` in a new immutable release root while
   the predecessor remains live.
2. Prepare and verify the eight-file bundle. Do not change the active selection.
3. Acquire the single production-operation lock and pause the monitor timer.
4. Stop origin, static, and runtime in the reviewed order. Do not stop or write
   the database and do not enable the worker.
5. Atomically select the candidate evidence, environment, wrapper, and two user
   units; reload the user service manager.
6. Start runtime, static, origin, and tunnel. Prove direct and public `/live`,
   `/ready`, exact candidate identity, unchanged database/legal authority,
   `externalEffects=false`, and the reviewed plain-language routes at all six
   width modes.
7. Resume the monitor timer and run one immediate monitor cycle.
8. Retain the exact predecessor and paired encrypted restore. Retirement remains
   unauthorized.

If any candidate check fails, restore the predecessor active evidence,
environment, wrapper, units, and services. A database restore is not required
because FIN-016 is forbidden from changing the database.

The control module performs no filesystem, SSH, systemd, network, database,
DNS, browser, payment, or provider effect. It validates the exact authority and
emits a deterministic plan for the separately reviewed action adapter.
