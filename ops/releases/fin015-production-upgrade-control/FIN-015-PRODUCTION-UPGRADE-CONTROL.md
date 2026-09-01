# FIN-015 held production database-upgrade control

State: prepared and fail closed; not authorized for live execution

This control is specific to installed production commit
`420bd8a424da3331514723d40b5be9fb5131dfe3`, epoch
`fin012-installed-truth-420bd8a-20260825`, and verified-held candidate
`8e59f2e9d776dbebbb705d11fcc938beadd7b9cd` under protected control
`961107c823d492457596c4f1830ddcf88b355676`.

The database transition is exact:

- 98 to 102 migration files.
- 294 to 299 tables.
- predecessor schema `2b1034e6e9ef99e27d6941b07b1fb29f8dd4ecead3637ef498850ad877ce2189`;
- successor schema `63e9c1d2066fa461d65244773465becf4719610b911afacddaf3bddf3e7095f0`;
- migrations 146, 147, 148, and 149 only, in that order.

Rollback preserves two distinct truths: installed artifact manifest
`dfff4b9b34553abe78c0d5bdc441d9264ab23883f94bdbadd2bee347285f34f3`
and the protected candidate's deterministic rollback artifact manifest
`b4cd31821d8755c8c7ea444f3b175e89f5072a7183aa42385034ef2aa3a55be0`.
They are not interchangeable, and the live control must bind and retain both.

The `preflight` action is read-only. The `upgrade` action refuses to run
unless all protected services and timers are quiesced, the exact installed
database and public epoch remain authoritative, the protected candidate and
held CI receipt are exact, and a successful encrypted Dell-to-Zen rollback pair
is less than one hour old. The action obtains an advisory lock, refuses any
second database connection, verifies every migration byte and digest, proves
all predecessor rows remain, and leaves provider, payment, DNS, customer,
acceptance, publication, install, and public-cutover effects false.

Because each reviewed SQL file owns its transaction, any failed live attempt
requires restoring the paired encrypted backup before restarting the retained
predecessor. A database-success receipt still authorizes no runtime install or
public cutover; those require separate controls.

Do not create a live control or run `upgrade` without a fresh successful
backup/readback and exact action-time owner authorization for the FIN-015
database mutation.
