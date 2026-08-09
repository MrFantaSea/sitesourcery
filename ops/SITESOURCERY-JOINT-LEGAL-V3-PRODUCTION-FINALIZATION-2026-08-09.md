# Site Sourcery joint legal V3 production finalization — 2026-08-09

Status: **owner-approved production tuple finalized; not pushed or deployed**

The exact approved Privacy V3 and Website Terms V3 content was finalized once
at the real shared UTC instant `2026-08-09T15:25:59.000Z`. No review timestamp
or disposable `2099` proof value was used as production authority.

## Exact production tuple

| Field | Value |
| --- | --- |
| Privacy version | `SS-HOSTED-PRIVACY-2026-08-09-V3` |
| Privacy SHA-256 | `5713fd6776c6ba41dbbac1b4d1ac0d9f1b6857ba01128e5d74c4f3c5287a4967` |
| Privacy bytes | `29,610` |
| Privacy artifact URI | `https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V3/` |
| Website Terms version | `SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3` |
| Website Terms SHA-256 | `b179ee8b6ed713b6b19b20daf320e84a9e89f2ac166504942919f8c4e280a602` |
| Website Terms bytes | `26,171` |
| Website Terms artifact URI | `https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3/` |
| Shared effective UTC | `2026-08-09T15:25:59.000Z` |
| Three-document authority SHA-256 | `ae52bb144a3cb9bd09709cd58ce43878ec2a03d650a19ff197532ea51cd4d1cf` |

The product and website documents share the Website Terms version, digest, and
effective instant. The product document uses the scoped URI
`https://sitesourcery.com/legal/website-terms/#self-service`; the website
document uses `https://sitesourcery.com/legal/website-terms/`.

Document IDs remain:

- Privacy: `00000000-0000-4000-8000-000000000048`
- Product: `00000000-0000-4000-8000-000000000103`
- Website: `00000000-0000-4000-8000-000000000104`

## Retained release bundle

The complete six-file, non-secret finalization bundle is retained at
`ops/releases/joint-legal-v3-2026-08-09T152559Z/`. Its receipt has SHA-256
`d0038d91ad96f0b2c00c544fc4ad7fa9d2f0014114fba507715a8c5943430760`.

| Artifact | SHA-256 | Bytes |
| --- | --- | ---: |
| Legal center | `1f8babe61f13ce74085b23027a7e30bcfb8191bf36d2e0de4166c441acf145c8` | 4,980 |
| Privacy current | `5713fd6776c6ba41dbbac1b4d1ac0d9f1b6857ba01128e5d74c4f3c5287a4967` | 29,610 |
| Privacy versioned | `5713fd6776c6ba41dbbac1b4d1ac0d9f1b6857ba01128e5d74c4f3c5287a4967` | 29,610 |
| Website Terms current | `b179ee8b6ed713b6b19b20daf320e84a9e89f2ac166504942919f8c4e280a602` | 26,171 |
| Website Terms versioned | `b179ee8b6ed713b6b19b20daf320e84a9e89f2ac166504942919f8c4e280a602` | 26,171 |

The current and versioned bytes are identical for each document. The bundle is
the only permitted input to the final hosted build:

```sh
/private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node \
  scripts/build-hosted.mjs \
  --joint-legal-v3-finalization \
  ops/releases/joint-legal-v3-2026-08-09T152559Z \
  --output ABSOLUTE_OUTPUT_OUTSIDE_REPOSITORY
```

Pinned Chrome 149 proof SHA-256
`e2201bc81770f1d31228f39b93afde5b6446c4054ad0779c0e0d17a8346cfcfc`
is retained at
`ops/releases/joint-legal-v3-2026-08-09T152559Z/proof/browser-proof.json`.
It binds this receipt digest, effective UTC, authority digest, all five artifact
identities, and all nine screenshot hashes. It records three legal routes at
`320×720`, `390×844`, and `1440×1000`, loopback-only network activity, and no
missing files or browser errors. The browser proof is evidence about the tuple;
it is not itself release authority.

## Scope and continuity

The finalized documents cover saved projects, the `$5` Download, the
authenticated `$200` Website assessment and its evidence/report/credit, and
accepted Custom quote, automatic-tax invoice/payment, job, progress, access,
completion, handoff, ownership, and workmanship flows.

Alakazam billing/lifecycle, Care, customer-domain purchase, Site Sourcery
publication, and Responder remain held. The accepted Alakazam Care/lifecycle
policy belongs to a later Privacy V4 and is not incorporated in this tuple.

Privacy V2 remains SHA-256
`b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b`
at 19,935 bytes. Website Terms V2 remains SHA-256
`bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196`
at 21,380 bytes. Existing acceptance evidence is not rewritten.

## Local proof

- Pinned Node 24 focused legal/API/migration suite: 134/134 passed.
- Operations configuration suite: 36/36 passed.
- Fresh PostgreSQL 16: all 57 migrations applied with this exact tuple;
  pre-v48 project creation remained held, post-v48 joint readiness was fully
  true, V2 evidence was byte-identical, a rogue fourth acceptance was rejected,
  and the disposable database was removed with `databaseAbsent true`.
- The standard hosted builder consumed and verified this retained bundle.
- The three final legal pages passed the repository HTML validator.
- Pinned Chrome proof passed three routes × three viewports with exact receipt,
  artifact, screenshot, and loopback-only network binding.

## Remaining activation boundary

This finalization does not itself publish the pages or lift project creation.
Deployment must use the retained bundle, apply migration 48, install the exact
public environment tuple from `ops/hosted.env.example`, and prove hosted bytes,
PostgreSQL readiness, and runtime authority on the same committed release.
Stripe, DNS, Caddy, publication, and every held product remain separate gates.
