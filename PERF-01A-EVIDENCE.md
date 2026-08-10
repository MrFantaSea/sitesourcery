# PERF-01A Static Delivery Evidence

## Identity and scope

- Base: `f227b3d3550f78d20a5882b1c2be8666b84df927`
- Branch: `feat/perf-static-20260810`
- Worktree: `/private/tmp/sitesourcery-perf-static-20260810`
- Runtime: Node `24.18.0`
- Scope: static assets, metadata, artifact ledgers, generators, tests, and local headless proof only
- Effects: no network, provider, DNS, deploy, push, control, commercial, or production effect

## Provenance and prompts

- No image-generation prompt or network source was used.
- Every hero derivative comes from the existing canonical `assets/site-sourcery-main-street-v2.webp` bytes at SHA-256 `5c3e35438fdfbd73e1f035a09c39ebe012a8b7708f61a4ef5adaedd39b19528a`.
- The shared OpenGraph PNG retains the existing reviewed SVG source and uses a deterministic local palette-compression stage.
- The preserved encoding review directory is `/private/tmp/sitesourcery-perf-static-candidates.ZN6AUV`.

## Milestones

1. Measured the untouched source, Pages, hosted, hero, OpenGraph, and Legal V2/V3/V4 evidence bytes.
2. Reviewed AVIF, WebP, JPEG, portrait-crop, landscape, and OpenGraph candidates from the canonical sources.
3. Replaced the Domains CSS image fetch with one responsive `picture`, two media-matched AVIF preloads, intrinsic dimensions, eager decoding, and high fetch priority.
4. Added only source-backed OpenGraph, Twitter, `WebPage`, and `WebSite` facts.
5. Reconciled the exact Pages, hosted, legacy public-truth, and current v2 Legal V4 ledgers while all release and provider controls stayed unchanged.
6. Proved exact responsive selection, visual continuity, overflow, accessibility structure, and byte evidence in pinned headless Chromium.

## Exact byte evidence

| Item | Before | After | Change |
| --- | ---: | ---: | ---: |
| Domains image at 320x720 | 616,960 | 30,837 | -95.0% |
| Domains image at 390x844 | 616,960 | 56,018 | -90.9% |
| Domains image at 1440x1000 | 616,960 | 194,925 | -68.4% |
| Shared `og.png` | 976,066 | 384,846 | -60.6% |
| Regular Pages artifact | 5,330,581 | 5,971,674 | +12.0% |
| Hosted artifact | 6,488,489 | 7,129,582 | +9.9% |

The artifact totals grow because each browser receives a negotiated AVIF, WebP, or JPEG from five responsive source variants; no request downloads all fallback files. The original 616,960-byte hero remains source-only for provenance and private review and is absent from both publication ledgers.

## Browser evidence

- Browser: Google Chrome for Testing `149.0.7827.55`, headless only
- Result: `3/3` viewports passed at `320x720`, `390x844`, and `1440x1000`
- Selected assets: portrait `360` AVIF, portrait `529` AVIF, landscape `1672` AVIF
- Every viewport: one hero request, exact encoded body size, complete intrinsic image, eager/high-priority/async behavior, no horizontal overflow, one `h1`, focusable `main`, working skip target, labelled input, live status, and no duplicate IDs
- Largest contentful paint observation: customer copy remained the reported LCP element at all three viewports; the fixed artwork did not displace it
- Preserved screenshots: `/var/folders/q7/pr3yjwgj0tz6f2pc9z9szj2r0000gn/T/sitesourcery-perf-static-screenshots-6EsO5u`

## Legal and release guard

- `25/25` retained Legal V2/V3/V4 source, fragment, receipt, and evidence files match the pre-edit byte counts and SHA-256 values.
- Tracked diff under `legal/`, the sealed V4 release evidence root, and hosted legal truth paths: `0`.
- Legacy verifier semantic changes are limited to the 15-for-1 public asset ledger replacement, the exact new OpenGraph digest, two `76` to `90` count expectations, and AVIF/JPEG inclusion in the existing image-size budget.
- Current v2 test reconciliation is limited to `80` to `94` ledger counts and exact pre-commit inclusion of the 15 new asset blobs. The v2 verifier and workflow are unchanged.
- Frozen legacy base, predecessor, catalog, projection, topology, changed-path, authority, control, and frozen-blob checks are unchanged.
- The archived non-gate vNext fixture suite retains its pre-edit shape: `137` pass and `19` fail. No stale assertion was weakened.

## Proof summary

- Static focused tests: `4/4` pass
- Legacy public-truth verifier/workflow tests: `77/77` pass
- Current v2 verifier/workflow and Pages Legal V4 tests: `30/30` pass
- Full local Node regression: `796/796` pass
- Repository `check`: all five command gates pass
- Pages: `90` exact files pass build and check
- Pages Legal V4: `94` exact files pass build and check
- Hosted: `100` exact files pass build, verification, and HTML validation
- Browser: `3/3` exact viewports pass
- `git diff --check`: pass

## Wiring and residuals

- Pages owns the exact public asset ledger; hosted reuses that ledger. No runtime, server, provider, customer-control, DNS, workflow, or deployment wiring is needed.
- Production minification was not added because exact Legal bytes and source debuggability already pass without it.
- Production cache policy was not changed because provider and deployment configuration are outside this packet.
- All held product and release controls remain held.
