# GOV-PROVENANCE-CI — candidate evidence guard

Recorded September 20, 2026. Implementation `434aa1384c2ad7a31ea0c7992f648bb12927e43f`, tree
`7ff87c19a762c698ee82019da6b153bde123674a`, sole base `d180bbcbdda786c3988c9f3fa6704558d42581f6`.

## Result and scope

Future release candidates now require matching provenance before Site quality
can pass. Held proof input and final commands use the same verifier. The saved
control-graph extraction was completed in the five-file checkpoint allowlist:
repository verifier, CLI, its tests, Site quality workflow and held runbook.
No product/database/runtime/provider configuration changed.

The validator distinguishes local evidence, actual two-parent PR merge,
protected squash and exact one-file successor-control graphs. It binds the
retained earlier implementation/tree/base, accepts only the two canonical
metadata files plus ledger append as the evidence delta, preserves old ledger
bytes, verifies canonical provenance hash/identities/links and requires complete
proof and cleanup dispositions. Missing source objects, stale or incomplete
proof, extra code, changed history, invalid file modes and Git overrides fail.
The implementation branch is retained so I remains available after squash.

## Verification

- Focused pinned Node 24.18.0: 43 passed, zero failed/skipped. Log SHA-256
  `db252f8fa0655844aec2992176e999af6d4e16b10ac5948daacee2dfa66bd01b`.
- Complete `npm test` on clean implementation I: exit 0, 2,421 passed and 20
  existing skips (four retired Privacy V3 fixtures; sixteen separately enabled
  PostgreSQL integration cases). All static, catalog/legal, product, self-hosted,
  hosted, operations and both artifact build/check stages passed.
- Rebuilt hosted browser audit passed 24 routes by six width modes, including
  reflow, account/maker, customer/owner payment and handoff fixture journeys.
  These are local fixture proofs, not new live provider transactions.
- Full proof ran 14:47:25–14:51:41 UTC, with HEAD/tree/status unchanged. Log SHA-256
  `f738b9068401628231f97b119ef3c8eed0daa4d908c7c39f5b4fa826b96c2fa5`.
- Root performed adversarial self-review; no independent-review claim. Cases
  include absent/failed proofs, incomplete PostgreSQL disposition, pending
  cleanup, stale identities, rewritten evidence/ledger, extra code, symlink,
  dirty checkout, unavailable I, wrong PR base and unproved merge tree.
- No data behavior/migration changed; a new real PostgreSQL drill is inapplicable.
  Existing six-step held receipt and cleanup validation remain tested.
- All 51 temporary fixture directories created during the full run were removed
  and absence checked. Cleanup initially stopped at an intentionally read-only
  test fixture; owner write permission was restored only on these task-owned
  directories. Test runner/private browser exited. Cleanup receipt SHA-256
  `95d8a3c725bc441656d9f1a44ce8d5496df31979e9d5283679569c1181bb16d6`.

Full logs, review and cleanup readback are retained outside the repository in
`/Users/fantaseamac/SITESOURCERY-GOV-PROVENANCE-CI-2026-09-20/`.
Pinned private Node/Chromium tools and ignored built projections remain retained.
No unrelated storage or crypto workloads were touched.

## Limits and subsequent gates

The verifier checks authored evidence structure and exact Git binding; it does
not independently establish the truth of review claims or read external logs.
Site quality also runs the full suite. Existing GitHub required-check/review
settings are unchanged; passing workflow and enforced branch policy are distinct.
Exact PR/main and non-deploying Pages results attach after this separate evidence
commit; this document does not invent future run results or its own commit SHA.

The exact pre-guard baseline is grandfathered only as history. Historical
FIN016-ORIGINAL-RECEIPTS and FIN017-ORIGINAL-RESULTS stay explicitly open. No new
runtime index, v1 receipt rewrite, manual held run, deployment, provider action,
spend, DNS, legal acceptance or customer effect occurs. Rollback is a separately
reviewed source correction through the normal branch workflow, never deletion
of existing evidence or weakening production effect guards.
