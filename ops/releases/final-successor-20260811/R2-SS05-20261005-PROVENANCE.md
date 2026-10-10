# R2 / SS-05 credential concurrency correction

Completed locally 2026-10-05T23:21:13.175255+00:00. Not deployed or release-qualified.

Implementation `be58bc0c9be85ab2d373fbe8bdf1769694004874`, tree `0b67874d317a2fa5d8c427a5e2a5b7c620aecdbc`, base `fe42ef27ad80ef4960e5077b17d4a114d5f74ef2`. Earlier source checkpoint `4ba1ec9` is preserved.

Real PostgreSQL reproduced stale sign-in after completed password rotation in both READ COMMITTED and canonical SERIALIZABLE modes. Each baseline account reached credential revision2 with one unrevoked session. The correction rechecks the verified hash and revision while holding the credential row lock through session issuance, reauthentication or password replacement. Parent key-share locking preserves the existing recovery lock order. Recovery now captures time after acquiring its credential lock and rechecks token expiry, preventing stale revocation timestamps after waits. No schema migration.

Pinned Node24.18.0 / PostgreSQL16.14:18 real concurrency/expiry scenarios pass across both transaction modes. Coverage includes stale sign-in/rotation versus rotation/recovery, stale reauthentication, expiry after waiting, valid current sign-in/reauthentication, and inverse-order waiting plus revocation. Canonical serialization failures fail closed; a whole-operation retry is explicit in the inverse-order fixture. Deadlocks/timeouts are not accepted as authentication rejection. Existing real mail acceptance, registration activation, recovery supersession/replay and credential configuration checks pass.

Final focused run40pass/1failure was an existing fixed synthetic message-ID collision on rerun. After unique per-run fixture IDs, the affected real mail acceptance test passed separately. Thus41 focused tests are covered; this is not a claim of one all-green final invocation or a full release suite. Earlier failed baseline, recovery timing regression and initial contract-model adaptation logs are retained. Independent read-only review found no remaining actionable issue.

Evidence: `/Users/fantaseamac/SITESOURCERY-SS05-2026-10-05/proof.json` records log SHA256s and cleanup. The exact disposable database was dropped with zero connected clients; absence verified and the existing PostgreSQL service preserved. Original three-file selfhost erasure work remains excluded. No HQ, production, provider, public routing, GitHub push, spending or crypto change. Consolidated candidate qualification/public deployment remain pending.
