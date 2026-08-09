# Site Sourcery joint Privacy V3 and Website Terms V3 content seal — 2026-08-09

Status: **owner-delegated content approval; unreleased; not deployable**

This engineering evidence record is not legal advice and does not claim that
either document has been published. The owner delegated the final legal
recommendations and authorized a later coordinated go-live. The seal binds the
exact reviewed content while leaving the production version, effective UTC
instant, final page digests, byte counts, artifact URIs, and authority digest
unset.

## Exact approved content

| Artifact | Review SHA-256 / bytes | Release-normalized template SHA-256 / bytes |
| --- | --- | --- |
| Privacy V3 | `f2e40058b8c34a5e5c6c9f4d4892ac5311ff0357ca71f84a0edd8199242ccef1` / `29,874` | `fa6c804bab0d5db93e5e30b76cea0e40e5158433d055907f637ee84366f9d29d` / `29,633` |
| Website Terms V3 | `173b025f9a26d7cd7d491ac56a1ca3d6680a0df67cde95a8511642602b159d71` / `26,224` | `d5ec519061dbec41821bae7fc79e0220427cdeee8591c515120f3f17aaa6adc1` / `26,200` |

The exact approval-receipt canonical digest is
`147ae9e84f508099842d3f0b780c103e6898f9a3041911338c08087e0ee100c2`.
The joint content-seal canonical digest is
`9d8f0bfe025278d97d130466f641eed78e740406899741904c3db83f3ce2ebe8`.
The serialized proof seal generated outside the repository has SHA-256
`cbb5896fafdce59a167b48a1ae6697068b64084d385fd0c51b488c4d17d19fc6`.

Every field in the seal's `release` object is `null`. The production tuple must
not be copied from a disposable proof or inferred from this approval time.

The fail-closed finalizer was exercised with a synthetic `2099-12-31` tuple
only. That external, nonproduction receipt has SHA-256
`c36c80086f590be9476d08d8b61879c7be87fd174871408fb9d6adc2c6255a59`.
Its pinned Chrome 149 browser/network proof has SHA-256
`4542faf3d90100579cfab4b68e35e66dbadf9b3ec8893a3bfe4ca99f1fdbd6d8`
and records three legal routes at `320×720`, `390×844`, and `1440×1000`,
loopback-only network activity, no missing files, no browser exceptions, and
nine screenshots. Neither digest is production authority.

## Active and held boundary

The joint content covers only:

- the free guest maker and signed-in saved projects;
- the one-time `$5` HTML Download;
- the authenticated `$200` Website assessment, evidence, findings, report,
  and one-use Custom credit;
- accepted Custom quote, invoice, Stripe automatic-tax payment, job, progress,
  access-reference, change, completion, financial-clearance, handoff, ownership,
  and 30-day workmanship records.

Alakazam subscription billing, lifecycle, Care, publication, customer-domain
purchase, and The Responder remain held. The accepted policy
`SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1` is not incorporated here and belongs
to a later Privacy V4 release.

Privacy V3 identifies the active provider and category boundary: Stripe for
checkout and verified payment/tax evidence; Resend for transactional account
email with open/click tracking required off; Proton Mail for direct email;
Cloudflare's public DNS resolver for an explicit Domains preflight; and the
configured hosting, PostgreSQL, backup, and file-delivery roles for authenticated
service records. Retention is stated as purpose- and obligation-based because
the implementation does not support one universal deletion deadline.

## V2 continuity

No V2 archive was edited. The immutable evidence remains:

| Artifact | SHA-256 | Bytes |
| --- | --- | ---: |
| Privacy V2 | `b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b` | `19,935` |
| Website Terms V2 | `bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196` | `21,380` |

Migration 48 adds joint V3 documents and artifact bindings without updating,
retiring, or deleting V2 documents or prior acceptance evidence.

## Cutover rule

At the actual control-site cutover, capture one canonical UTC instant. Its UTC
date must match both versions:

- `SS-HOSTED-PRIVACY-YYYY-MM-DD-V3`
- `SS-HOSTED-WEBSITE-TERMS-YYYY-MM-DD-V3`

Run `scripts/hosted-truth/finalize-joint-legal-v3.mjs` with the external content
seal, both versions, that exact `effectiveAt`, and `--owner-approved`. Carry the
resulting receipt unchanged into the hosted artifact, migration 48, runtime
environment, readiness proof, and deployment manifest. Do not run the
finalizer early and do not substitute the disposable `2099-12-31` proof tuple.
