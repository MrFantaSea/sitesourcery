# Site Sourcery Privacy V3 content seal and release gate — 2026-08-08

Status: **owner-approved content; unreleased; not deployable**

This is an engineering evidence record, not legal advice. It records the
owner's approval of exact reviewed bytes without claiming a publication time
or authorizing deployment.

## Exact approved content

The exact integration candidate `0dfd87e90d2142e78e9915951dcdffc866d6cacc`
reproduced the approved Privacy V3 review and generated a nondeployable content
seal at:

`/private/tmp/sitesourcery-go-live-privacy-v3-content-seal-0dfd87e/privacy-v3-content-seal.json`

| Evidence | Exact value |
| --- | --- |
| Review artifact SHA-256 | `1fdc50606115e31e61aad1063e724949f0e2efb3444aaba775a7db9c14523a14` |
| Review artifact bytes | `25,994` |
| Release-normalized content-template SHA-256 | `8bc347cf8c0755d7e923fef60f5c481660ee37ca3dd1bbaa1df4f1371a018bfc` |
| Release-normalized content-template bytes | `25,763` |
| Approval receipt SHA-256 | `3bfcc7a555e47d8ed2594275596e7bf9b2b45be08ad857b71e29a05e514dbc15` |
| Content seal SHA-256 | `b040ee6c95830b732e18859eec6fe5ddfec56325e7357269fc5f0f14e6861d92` |
| Serialized content-seal file SHA-256 | `804bb82ae0a2b2fa77f1a068950e3734c06b625a072ad3e8d7380c3fe5b9ec60` |
| Published / deployable | `false / false` |

The content seal deliberately retains `null` for version, effective UTC,
full-page SHA-256, final byte count, artifact URI and authority digest. No
release authority was inferred from content approval.

The immutable accepted Privacy V2 archive remains exactly 19,935 bytes with
SHA-256
`b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b`.

## Effective-time decision

Use the **actual control-site publication instant**, not the review or approval
time, as `effectiveAt`. Run the finalizer inside the owner-approved cutover
window immediately before publication and carry the resulting tuple unchanged
through migration 48, hosted artifacts and runtime environment.

The version date must match the UTC date of that instant. If publication occurs
on 2026-08-09 UTC, the proposed version is
`SS-HOSTED-PRIVACY-2026-08-09-V3`. The earlier
`SS-HOSTED-PRIVACY-2026-08-08-V3` suggestion must not be used after the UTC
date has changed, because the finalizer correctly rejects a version/effective
date mismatch.

This timing choice means the final full-page digest, final byte count and
authority digest are intentionally not claimed yet. The page digest and byte
count depend on the final version date; the authority digest additionally binds
the exact publication instant. Computing and sealing those values early would
create a notice that claims an effective date before it was published.

## Remaining legal release gate

Privacy content approval does not approve Website Terms V3. WT-01 through
WT-12 in
`ops/SITESOURCERY-WEBSITE-TERMS-V3-ENGINEERING-REVIEW-2026-08-08.md` still
require owner rulings and approval of one exact rendered artifact. Until that
happens, accepted Website Terms V2 and its receipts remain the only authority,
and project creation remains held.
