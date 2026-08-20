# FIN-008 data epoch, backup, restore, and rollback provenance

Date: 2026-08-20
State: proved; exact successor data epoch sealed with every effect held
Candidate branch: `integration/final-successor-20260811`

Input commit:
`b2aafdd9a873007069780e4a9d890217802fa4c0`

Input tree:
`4d182564c0158e19e8809bc38ccfb9ec17d65034`

Implementation commit:
`5e69fba310fd5f3a454cfdbf14dd706a967e1259`

Implementation tree:
`af5ec9590f83bf64af2783371e863b63b1d184d7`

Machine-readable receipt:
`fin008-data-epoch-receipt.json`, SHA-256
`d3954dccf527bc60ba12e5ac4163c018550772767ecce1dd7f5815ad95301099`

## Exact source and migration denominator

The protected HQ PostgreSQL database remained read-only. Its exact executable
predecessor is commit `84aca6b757a806b428ae0cce8115c12dcc6486cd`,
tree `bd7859348a54b633173d386e0eadc8acc4c8ad54`. The predecessor contains
an unchanged 58-file migration prefix; the candidate adds exactly 37 files for
an exact 95-file successor inventory.

The canonical migration-manifest SHA-256 values are:

- predecessor 58 files:
  `e7f9c03e6fddebc3dcef52962d45f1789887a3a89867a4d964fe65278229ae84`;
- additive 37-file delta:
  `4737b46d786c5fc0ba376d6ad6a98bcc09046e7ad4d740d2891eae44e9c53d99`;
- complete 95-file successor:
  `8e5a5a8b52432335ffb05d7d83bf5e88836af2c9e12149547ff037b4009d9880`.

The owner-approved Legal V5 correction at the exact input commit adds one
additive migration and its bounded runtime/client/release bindings. The FIN-008
evidence implementation updates only the operator runbook and machine-readable
receipt for that exact corrected candidate. It imports no donor branch and
does not enable application, public, or provider effects.

## Empty and predecessor-upgrade convergence

A fresh PostgreSQL 16 database passed all 95 migrations and every subordinate
database journey. The verifier-owned database was removed automatically and
its final absence was proved.

A transactionally consistent logical stream of the exact protected
predecessor was restored only into disposable local databases. Before upgrade
it contained 201 base tables (`auth=1`, `ss=200`). Applying only the frozen
37-file delta produced 287 base tables (`auth=1`, `ss=286`). Every one of the
201 predecessor relations remained present and no predecessor row count
decreased. The only changed predecessor row counts were the expected additive
successor backfills:

- `ss.legal_documents`: 10 to 14;
- `ss.service_catalog_policies`: 9 to 17;
- `ss.service_catalog_coverage`: 33 to 64;
- `ss.legal_document_artifacts`: 6 to 8.

Fresh install and predecessor upgrade converged to canonical portable schema
SHA-256
`de7a4d476899db85d0d4bf2e93c9f54210f39bc77c416586a8b960cf0e5a397a`.
The successor row-count SHA-256 is
`9202ca42ecf31e03cf3669e92078a9bbe782e6250986c3b9bcb1d5fd61a1f015`;
normalized ownership SHA-256 is
`d78890529e36bfbc5e364c8dd710e3e2bebd89d28995ffa78c21c1cbeab8fca2`.
The canonical snapshot covers 4,785 columns, 4,138 constraints, 1,064 indexes,
111 policies, 294 relations, 585 routines, 3,262 table privileges, and 488
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
attempt is `fin008-4c59921-20260820T135043Z` under the marked
`zen-sitesourcery-backup-01` failure domain. Its source failure domain is
`mac-fin008-rehearsal-01`, so custody is distinct from the source.

The encrypted backup is 3,790,956 bytes, ciphertext SHA-256
`59e35a8a38e6d23e439c4d04403a81df9aa5dad72a2fc475da1ed07d291ed598`,
and streamed plaintext SHA-256
`edcec2cb733cf794ed4aa1180e306db1ddd0cefee55c56e52d50b93cac3f0711`.
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
`5c026aa6a470eb4060465a38ca5a86d93e288477f61545bfd4a44ea452660d29`.
Against the successor database it deliberately failed closed with
`DATABASE_NOT_MIGRATED` on `custom_service_quotes_terms`, while read-only
tenant isolation and predecessor-contract visibility still passed; proof
SHA-256
`4eec791b8be703c57b6132e0eefef5a8e30ce4fea0cea41fec4f0d789e61804f`.

That refusal is required safety: rollback selects the retained predecessor
runtime and retained predecessor database together. Old writable commerce code
is never paired with successor commercial data. No destructive SQL, provider
operation, or external effect was part of either proof.

## Proof ladder and cleanup

- Focused FIN-008 tests: 3/3; exact migration bytes, receipt bindings, effect
  holds, cleanup, and disposable-name guard passed.
- Clean pinned-Node operations ladder: 209/209.
- Complete clean `npm test`: exit 0; canonical runtime/product/public-truth,
  hosted/service, operations, deterministic build, artifact, and browser
  suites—including deterministic 93-file Pages and 112-file hosted builds—all
  passed.
- Current browser audit: 24 hosted routes at all six required width modes,
  including 720 pixels at 200% reflow, plus retained customer, payment,
  handoff, race, keyboard, and 44-pixel-control journeys.
- Exact fresh PostgreSQL 16 verifier: all 95 migrations and every subordinate
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
