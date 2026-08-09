# Site Sourcery go-live candidate evidence — 2026-08-08

Updated at: 2026-08-08T20:12:00-0400 (EDT)

Status: **held release candidate; no push, deployment, provider effect, or
cutover authorized**

This is an engineering release record, not legal advice or a claim that the
site is live. The current executable release proof is bound to commit
`0dfd87e90d2142e78e9915951dcdffc866d6cacc`.

## 1. Fresh integration authority

The worktree is `/private/tmp/sitesourcery-go-live-integration-20260808` on
`release/go-live-integration-20260808`, created from exact base
`a0f024d8b1a611a40d03e801bd44d23e9895a29e`.

Integrated sealed inputs:

| Lane | Sealed input | Integration commit |
| --- | --- | --- |
| Privacy V3 phase A | `ec9a82e12643eced9f80e9ea7c4bdae533dfb1c1` | `f147a6b` |
| Privacy V3 phase B | `becbe147255f93ddbf444dbb54f5930a52444455` | `dde1c9c` |
| First-dollar public truth | `93792d941f9416d44d992811833d1b641fedd19e` | `f47c060` |
| Completion matrix | `fd0d098f04bf1e85e074eac6d55c59ab32af4d3e` | `dc35dd5` |
| Privacy V3 backend and migration 48 | `bf53972c967dcf77e15015aac0e429b825f8ca45` (contains `f60e933`) | `48dbb9e` |
| Privacy V3 content/release separation | `f4d7064b4b859766fea9378fc03255e37aeb435a` | `6963f50` |
| L2 lifecycle, migrations 49–52 | `0c9362ab9b3657c33676b5881a4c09277ff86a0d` | `172b54d` |
| L3 billing surfaces | `793aaf73aa935e2182d0ed450fbaf9b7b079d154` | `ffc80e0` |
| Migration-48 release harness | source `c155d2c` | `2caebe3` |
| Privacy content-seal browser binding | source `6b8cbc6` | `7bfda49` |
| L4 composition wiring | L2 and L3 WIRING-NOTES | `719b2ed` |
| L1 held publication controls and migration 101 | `0c71cf77192284275562e9a530b0d52ad5139865` | `2d12155` |
| Privacy V3 Abracadabra UI | `de7b4461ba4ec8c70009e0ce9664935527514d95` | `2246aa1` |
| 53-migration/22-journey release harness | L4 correction | `2c892d0` |
| Held-publication capability contract | L4 correction | `eac2bf2` |
| Complete held-publication HTTP authority proof | L4 correction | `0dfd87e` |

L4 alone changed the three composition roots. The L1, L2 and L3 modules are
wired, but every Alakazam commerce/publication effect remains held. L3's customer
billing-view asset is available only in the hosted staging artifact and is not
published by the public Pages artifact.

The known `scripts/hosted-truth/manifest.mjs` overlap was inspected rather than
assumed: phase B changes the legal/held-truth area around its original lines
96–110, while the existing Privacy UI branch changes staged-asset digests around
128–137. Those historical hunks were disjoint. The later L1/UI merge changed
both staged assets, so L4 recomputed the final hashes from merged bytes. The
combined browser gate runs both the legal-authority capture and held
publish/rollback/unpublish journeys at every viewport.

## 2. Exact PostgreSQL 16 and release proof

The successful command used pinned Node 24.18.0, the repository release
orchestrator, and caller-owned disposable PostgreSQL 16:

```text
npm_execpath=/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js SITESOURCERY_PG_CORE_RELEASE_ADMIN_URL=postgresql://fantaseamac@localhost:5432/postgres /private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node scripts/core-release.mjs
```

Receipt:

```json
{
  "ok": true,
  "databaseName": "ss_core_release_20260809t002028962z_ef642e68df59",
  "postgresMajor": 16,
  "migrationsApplied": 53,
  "customServicesJourneys": 4,
  "alakazamCoreJourneys": 5,
  "alakazamLifecycleJourneys": 10,
  "alakazamBillingJourneys": 3,
  "databaseAbsent": true
}
```

The replay applied migrations 1–47, proved migration 48 refuses unsealed
release constants, then applied 48–52 and 101 with a disposable proof seal. It also
proved the retained Privacy V2 artifact remained byte-identical and rejected a
rogue fourth legal acceptance.

Exact successful counts on the same executable checkpoint:

| Gate | Result |
| --- | ---: |
| Real PostgreSQL journeys | 22/22 |
| Main Node tests | 699/699 |
| Self-host tests | 19/19 |
| Hosted-service tests | 444 pass, 5 intentional skips, 0 fail |
| Operations tests | 52/52 |
| Public Pages allowlist | 76/76 files |
| Browser routes and widths | 15 × 3 = 45/45 |

The browser gate covered 320×720, 390×844, and 1440×1000, including the four-
stage account room, maker preview, Privacy V3 legal-authority capture and stale
recapture, held Alakazam publish/rollback/unpublish authorization, Custom
customer/owner payment and immutable handoff states, keyboard activation,
44-pixel controls, failure/race behavior, and zero horizontal overflow.

The exact immutable Privacy V2 evidence remains 19,935 bytes with SHA-256
`b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b`.

## 3. J-06 source quality audit

Lighthouse 13.4.1 drove pinned Chrome for Testing 149.0.7827.55 against all 15
held hosted routes. This local static pass intentionally did not claim hosted
API readiness; the separate functional browser audit supplied the exact API
fixtures and reported zero browser errors.

| Route | Performance | Accessibility | Best practices | SEO | LCP | Transfer |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 93 | 100 | 100 | 100 | 3.0 s | 415 KiB |
| `/about/` | 92 | 100 | 100 | 100 | 3.1 s | 418 KiB |
| `/abracadabra/` | 92 | 100 | 100 | 100 | 3.1 s | 410 KiB |
| `/abracadabra/app/` | 71 | 100 | 96 | 100 | 9.5 s | 1,548 KiB |
| `/contact/` | 94 | 100 | 100 | 100 | 2.9 s | 371 KiB |
| `/custom/` | 84 | 100 | 100 | 100 | 4.2 s | 799 KiB |
| `/custom/process/` | 91 | 100 | 100 | 100 | 3.2 s | 420 KiB |
| `/custom/scope/` | 81 | 100 | 100 | 100 | 4.7 s | 720 KiB |
| `/domains/` | 78 | 100 | 100 | 100 | 5.4 s | 859 KiB |
| `/faq/` | 95 | 100 | 100 | 100 | 2.8 s | 397 KiB |
| `/legal/` | 95 | 100 | 100 | 100 | 2.8 s | 385 KiB |
| `/legal/privacy/` | 92 | 100 | 100 | 100 | 3.1 s | 424 KiB |
| `/legal/website-terms/` | 92 | 100 | 100 | 100 | 3.1 s | 401 KiB |
| `/responder/` | 95 | 100 | 100 | 100 | 2.6 s | 392 KiB |
| `/work/` | 92 | 100 | 100 | 100 | 3.1 s | 514 KiB |

Summary: performance min/max/average `71/95/89.1`; accessibility
`100/100/100`; best practices `96/100/99.7`; SEO `100/100/100`. The production
dependency audit found 0 info, low, moderate, high, or critical vulnerabilities
across 67 dependency records.

J-06 remains PARTIAL. The app bundle and shared unminified CSS/JS are the main
correctable performance cost; the visual design need not change. Four routes
remain below a 90 performance target, so this record does not turn a completed
audit into a false performance pass.

## 4. Privacy V3 exact owner gate

The current candidate deterministically reproduced the exact review and sealed
its approved content without creating release authority. Evidence is at:

`/private/tmp/sitesourcery-go-live-privacy-v3-content-seal-0dfd87e/privacy-v3-content-seal.json`

Exact approval identity:

- SHA-256:
  `1fdc50606115e31e61aad1063e724949f0e2efb3444aaba775a7db9c14523a14`
- Byte count: `25,994`
- State: `content-approved-unreleased`
- Published/deployable: `false/false`
- Version, effective UTC, release digest, and authority digest: all `null`
- Content-template SHA-256:
  `8bc347cf8c0755d7e923fef60f5c481660ee37ca3dd1bbaa1df4f1371a018bfc`
  at `25,763` bytes
- Content-seal SHA-256:
  `b040ee6c95830b732e18859eec6fe5ddfec56325e7357269fc5f0f14e6861d92`

Release finalization must wait for the actual cutover UTC so the published
notice never claims to have been effective before publication. The UTC date of
that instant also selects the final version identifier. The complete rationale
and exact content evidence are in
`ops/SITESOURCERY-PRIVACY-V3-CONTENT-SEAL-AND-RELEASE-GATE-2026-08-08.md`.

Website Terms V3 remains a separate owner decision. The 12 numbered proposed
changes and ranked decisions are retained in
`ops/SITESOURCERY-WEBSITE-TERMS-V3-ENGINEERING-REVIEW-2026-08-08.md`. Accepted
Website Terms V2 bytes and receipts remain immutable until exact replacement
bytes receive owner approval.

## 5. Revenue-12 status on this candidate

Strict matrix arithmetic remains 0 DONE / 12 = 0.0 percent because PARTIAL
earns no release credit.

| Row | Current exact boundary |
| --- | --- |
| J-01 | Integrated public/held-offer truth and 45/45 browser proof pass; Privacy content is approved, but its cutover tuple and replacement Terms approval remain open. |
| J-05 | Runtime Custom/payment/workmanship truth passes; exact Website Terms V3 owner decisions and release bytes remain open. |
| TRUTH-05 | Privacy content is approved and nondeployably sealed; its cutover tuple is intentionally null and Website Terms replacement is unapproved. |
| AESTH-08 | Legal presentation passes at all three widths; final canonical legal bytes remain owner-gated. |
| J-02 | Authenticated assessment/Custom backend and browser components pass, but no exact-candidate public inquiry → activated account → quote → invoice → Stripe TEST payment → receipt browser journey exists yet. |
| J-09 | Provider adapters and operations gates pass; no real Stripe TEST payment exists for the $200 assessment, variable Custom build, and $5 Download on this candidate. |
| J-07 | Candidate has not been deployed to private staging because deployment is prohibited by the current assignment. |
| J-06 | Audit complete; performance correction remains as recorded above. |
| J-08 | Responsive owner fixtures pass, but no physical owner Mac/Pixel walk has been signed off. |
| SURFACE-04 | Fresh PostgreSQL 53/53, 22/22 journeys, cross-tenant/failure/race, safe projection, and 45-width proof pass; real provider test-mode and integrated browser-to-database coverage remain open. |
| J-10 | Owner walkthrough/cutover approval is intentionally not executed. |
| J-11 | DNS/TLS/live cutover is intentionally not executed; rollback is prepared separately. |

The current single critical-path blocker is **completion of the exact canonical
legal release set**: owner rulings and exact-byte approval for Website Terms V3,
then the actual-cutover Privacy version/effective UTC and resulting final
digests. Provider, private-staging, performance, device, and cutover gates
remain downstream work, not authority to bypass that legal gate.
