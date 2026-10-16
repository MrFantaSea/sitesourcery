# Prepare the existing tenant runtime for approved publication

Implementation `5d40faedfb435521aa0e241a2d7f1464901bbb41`, tree `45474a54203946e243cf14f65c3f6aa246671542`, direct protected base `d203e53769de20445956ae50ffaeb9b9ef1d8cb8`.

Two tracked PUBLICATION_HOLD sentinels blocked the existing runtime even after native approval. This change removes those source sentinels through a qualified release and corrects the selfhost README. Runtime code, exact-host authorization, immutable content integrity, private control transport and native /etc approval/hold checks remain unchanged. The owner authorized completing the system at no new cost. The existing owned sitesourcery.me domain is being moved to the Free Cloudflare zone using the already running HQ tunnel; DNS and native activation are separate effects.

## Validation

- Full `npm test` passed on the exact implementation: 2534 passed, 29 skipped. Includes Pages/hosted builds and actual Chromium checks of 24 hosted routes at six widths. Log SHA-256 `9f0639ea5df64ece49060a7dd78e937ac1138478986d929fb2e6e6d7a23a9173`. Skipped database/provider checks are not live evidence.
- The selfhost command within that full run passed all 29 checks: native and source holds, control-path isolation, exact host/TLS authorization, atomic release switching, restart recovery, integrity, erasure and symlink/traversal rejection. Extracted verbatim log SHA-256 `02c5515f9f00055f759a34fe564f9561ffb1a627958cc562887795369f4be40c`. The earlier targeted runtime run also passed20/20; it was not repeated separately.
- No database code, migration, dependency or executable runtime behavior changed. No additional PostgreSQL clone was needed.
- The initial five-second full run was blocked by the sandbox's localhost-listener restriction. Its original log SHA-256 `5be377d93a0ba36587c06e4ca8d7875d17723afaeb8531914e1ffb67881f88b7` is retained; unchanged source passed with approved localhost access. Owned scratch directories are removed and no owned Node/Chromium process remains. Original evidence and built artifacts are retained.

Root reviewed the three-file diff and the unchanged native, hostname, integrity and private-control guards. This source preparation does not activate billing or publication. At qualification, HQ serves8a8b/schema106 with native publication held. Protected GitHub checks, candidate-bound held qualification and exact native code deployment precede ingress/publication activation. DNSSEC restoration, real tenant delivery, customer payments and remaining Care/Responder/domain/integration acceptance are not claimed by this proof.
