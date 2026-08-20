# FIN-008 data epoch, backup, restore, and rollback provenance

Date: 2026-08-20
State: proved; exact successor data epoch sealed with every effect held
Candidate branch: `integration/final-successor-20260811`

Input commit:
`e6865bfb072aae7882e16ee7fa859c411703c6cb`

Input tree:
`03c169e426b6b36a71a57fd8e248fcf222887513`

Implementation commit:
`4820765bab1860bc71f494a1728fd2bda37b2891`

Implementation tree:
`2ab0571cc46cb6ec40a138fd411d2c7ccaa866cc`

Machine-readable receipt:
`fin008-data-epoch-receipt.json`, SHA-256
`fc5f1455d085e22b8937bbd8433d1045086d57818e59862ffb5d7d607da6b673`

## Exact source and migration denominator

The protected HQ PostgreSQL database remained read-only. Its exact executable
predecessor is commit `84aca6b757a806b428ae0cce8115c12dcc6486cd`,
tree `bd7859348a54b633173d386e0eadc8acc4c8ad54`. The predecessor contains
an unchanged 58-file migration prefix; the candidate adds exactly 36 files for
an exact 94-file successor inventory.

The canonical migration-manifest SHA-256 values are:

- predecessor 58 files:
  `e7f9c03e6fddebc3dcef52962d45f1789887a3a89867a4d964fe65278229ae84`;
- additive 36-file delta:
  `08e7d0ad0e62e74df2a5391bb19baeb666c08bcb373c8a85e6c085780a7ae2a1`;
- complete 94-file successor:
  `139d050a7c04bdc1a97bd9ec05fe28c887ad11d488282edf3bceb5246820791a`.

The implementation adds only the bounded FIN-008 verifier, focused tests,
operator runbook, receipt, and npm entry points. It imports no donor branch,
changes no schema migration, and does not modify application or provider code.

## Empty and predecessor-upgrade convergence

A fresh PostgreSQL 16 database passed all 94 migrations and every subordinate
database journey. The verifier-owned database was removed automatically and
its final absence was proved.

A transactionally consistent logical stream of the exact protected
predecessor was restored only into disposable local databases. Before upgrade
it contained 201 base tables (`auth=1`, `ss=200`). Applying only the frozen
36-file delta produced 287 base tables (`auth=1`, `ss=286`). Every one of the
201 predecessor relations remained present and no predecessor row count
decreased. The only changed predecessor row counts were the expected additive
successor backfills:

- `ss.legal_documents`: 10 to 11;
- `ss.service_catalog_policies`: 9 to 17;
- `ss.service_catalog_coverage`: 33 to 64.

Fresh install and predecessor upgrade converged to canonical portable schema
SHA-256
`c4788908ebdabbe2210f49ac001876fda082efe00814502220d47b3a6b4f3cd1`.
The successor row-count SHA-256 is
`f05f4e1fd7c415660568113b6fa264790fec43d9a003ccd30e80e31374719143`;
normalized ownership SHA-256 is
`04744f6c2253fe2d19e42c8472b515672b3293765d14316945d0153938c59aa0`.
The canonical snapshot covers 4,785 columns, 4,138 constraints, 1,064 indexes,
111 policies, 294 relations, 584 routines, 3,262 table privileges, and 488
triggers. Every application relation and routine belonged to the database
owner; every RLS table forced RLS; `service_role` retained bypass authority;
`authenticated` did not; identity crosswalks were present; lifecycle state and
commands remained held; provider effects were false.

The exact protected predecessor fingerprint observed through its fenced backup
was schema SHA-256
`e5d1efe881766fc201335e125f26fdb3c9c7cf27de61873b6f0b62201c0231a2`
and row-count SHA-256
`6cb1b7ce8f586a0df239bc03a788176675f8194b72d3a523ef05d35dc4845484`.
The source database was never migrated or mutated.

## Encrypted distinct-domain backup and clean-room restore

The converged candidate was dumped without a plaintext file and streamed
directly through age to the existing Zen custody recipient. The exact retained
attempt is `fin008-e6865bf-20260820T122536Z` under the marked
`zen-sitesourcery-backup-01` failure domain. Its source failure domain is
`mac-fin008-rehearsal-01`, so custody is distinct from the source.

The encrypted backup is 3,797,564 bytes, ciphertext SHA-256
`2916ef2de38363ba0ba258ead251d840b736e40f82011e8e77567e7afc272222`,
and streamed plaintext SHA-256
`8e4c60e93c7507cde64f23b1b5523a81f72041f20a4e77da9f189f33c46b9c82`.
The ciphertext and this receipt are mode `0400`; the exact attempt directory is
mode `0500`. Local and Zen receipt bytes match the receipt digest above.

Zen initialized one fresh PostgreSQL 16 cluster with data checksums, an exact
mode-0700 Unix socket, and no TCP listener. Age decrypted directly into
`pg_restore`; no plaintext file was created. The remote restored schema,
row-count, privilege, ownership, RLS, identity, lifecycle, and hold proofs
matched the upgraded source exactly. The temporary tunnel and cluster were
stopped; the exact restore and socket roots were removed and proved absent.
Only the encrypted backup and immutable non-secret receipt remain.

## Rollback compatibility

Immutable predecessor code was exercised only through read-only transactions.
Against a restored predecessor database it passed readiness and tenant/service
isolation; proof SHA-256
`b7e9919934c48c4a784fa20b814f108cb7b24ec34c8f87a90526dc843a2b1442`.
Against the successor database it deliberately failed closed with
`DATABASE_NOT_MIGRATED` on `custom_service_quotes_terms`, while read-only
tenant isolation and predecessor-contract visibility still passed; proof
SHA-256
`f1675426471c470c69afee59a7eced7ce074d783f52f0e023a55a8fddace64f3`.

That refusal is required safety: rollback selects the retained predecessor
runtime and retained predecessor database together. Old writable commerce code
is never paired with successor commercial data. No destructive SQL, provider
operation, or external effect was part of either proof.

## Proof ladder and cleanup

- Focused FIN-008 tests: 3/3; exact migration bytes, receipt bindings, effect
  holds, cleanup, and disposable-name guard passed.
- Clean pinned-Node operations ladder: 209/209.
- Complete clean `npm test`: exit 0; canonical runtime/product/public-truth,
  hosted/service (1,077 passed, zero failed, 14 intentional no-database skips),
  operations, deterministic 93-file Pages and 112-file hosted builds, artifact
  checks, and final browser audit all passed.
- Current browser audit: 24 hosted routes at all six required width modes,
  including 720 pixels at 200% reflow, plus retained customer, payment,
  handoff, race, keyboard, and 44-pixel-control journeys.
- Exact fresh PostgreSQL 16 verifier: all 94 migrations and every subordinate
  proof passed; disposable database absent after completion.
- Final local residue: zero matching FIN-008/verifier databases, no local
  ciphertext, no predecessor worktree, and no retained proof/browser process.
- Live `https://sitesourcery.com/` remained byte-identical at SHA-256
  `672d8ea082208c32c545d1bc7f01a077327a045eac236027531083e382584f9d`.

FIN-008 is complete and earns its five evidence-weighted points. The receipt
records `public=false`, `dns=false`, `provider=false`, `deployment=false`, and
`cutover=false`. This record grants no production install, public replacement,
DNS, Cloudflare, Pages, Stripe, Resend, Spaceship, Twilio, HQ, Dell, or cutover
authority. Private immutable staging and owner acceptance remain FIN-009.
