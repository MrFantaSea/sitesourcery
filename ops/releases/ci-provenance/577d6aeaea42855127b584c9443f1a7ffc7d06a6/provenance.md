# Complete the existing Care catalog and lifecycle

Canonical implementation `577d6aeaea42855127b584c9443f1a7ffc7d06a6`, tree `6c0a88d4f15f5d415ffe0afe45901c047215b6b2`, direct protected base `d2e9bae730b44eb300fbc2424a6f6d9e0196580e`.

Care previously exposed plans without a production agreement, checkout, verified paid-period or request/work lifecycle. This implementation adds explicit owner-issued written agreements, customer acceptance and separate checkout, verified monthly invoice periods, bounded request/work accounting, and cancellation/reconciliation using the existing Stripe and PostgreSQL architecture. Customer controls reuse the existing account room; private HQ uses the same renderer. Existing payment purposes and default holds remain. Migration107 adds nine Care tables without changing existing customer rows. The held release workflow adds one isolated Care PostgreSQL journey and cleanup.

## Actual validation and identity

Full `npm test` ran on original integration commit `e8f31f239f8e21288b7fcfd6b4140b1d95ad68e2`, whose entire tracked Git tree is exactly `6c0a88d4f15f5d415ffe0afe45901c047215b6b2`. It passed on 2026-10-16 at10:59:34Z: 2565passed,30skipped,0failed; both builds and actual Chromium24 hosted routes at6 widths passed. Stdout SHA256 `016dcc4956978d1982a68fa722c4c61400983f35324a74e1a902c1ca915bf863`; stderr is empty. Canonical source above consolidates only Git parentage for the existing release graph; `git diff` from the tested commit is empty and every source byte is unchanged. This is reuse of the original successful run, not a claim that it ran twice or under the new commit ID. Original integration branch/logs are retained.

Fresh PostgreSQL16 applied all107 migrations, then ran the actual Care payment test with a fake provider, including verified paid-period handling and cancellation/recovery. Receipt SHA256 `0f1662f620bbb87d2f5647fdc0675fd54b5a633d23e63c35b38ed92b5bd50eab`; test stdout `f49bd95582fcb0084ad2d39bd6705b9a102ed242aa1b986b0021e79c4cb78a4f`; durable schema `34c87c747c7cc573bbbef201c5f2ecd36498e796f6b1f83c04dac76da86b68f7`,308tables. Before/after acceptance schema is identical. Disposable database and all owned Node/Chromium scratch/processes are removed. Skipped tests are not live acceptance.

Initial integration copy/link/snapshot/browser-fixture failures and a later Runtime.evaluate timeout are preserved. The final successful unchanged-source run used caffeinate to prevent idle sleep; no timeout or acceptance guard was weakened. Root reviewed the core/payment/provider/UI integration, append-only migration inventory, isolated ninth CI database, source holds and immutable payment/tenant boundaries.

## Deployment boundary

This proof authorizes source qualification only. HQ remains on publication8c5/schema106. Production migration107, private HQ Care deployment, exact catalog/credential configuration and actual commercial activation remain separately reviewed effects. Five real Stripe price records exist, with no customer subscriptions/charges created. No paid sale, live invoice/cancellation, customer delivery, mobile push/call, or whole-system completion is claimed.
