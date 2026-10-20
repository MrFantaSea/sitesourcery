# Public navigation and control CI cleanup

Implementation `a6887acc1063988a677e5438e033334b4f907c61`, tree `9ae78c75c1d6ab2bd39a0489c0b1187c13116fd2`, direct protected base `cf6a2e94c73a6f5355c0e869777b14ef48993285`.

## Resulting behavior

The existing shared-chrome synchronizer now owns the approved seven-link header and current footer for 21 nonlegal canonical pages plus 404. It validates all targets before writing, preserves the current-route indicator and supports a check-only mode. The existing site checker detects drift from this maintained source. The footer explains the five branded services and links directly to the customer account. Worldwide wording, phone/email destinations, readable existing styles and residential-address privacy are retained. All 38 legal and legal-render-related files are byte-identical; every changed HTML byte outside its header/footer is unchanged.

The required `static-quality` GitHub job remains. Its existing provenance gate runs first; application/source candidates always run Chromium and the complete test ladder. An exact control-only successor-input change may reuse successful source quality proof only after authenticated GitHub reads bind the exact source parent/tree and repository to either a successful main-push run or the actual merged source PR's original successful run. The original attempt must contain the successful required job and dependency, provenance, Chromium and full-test steps. Missing, mismatched, redirected, failed or unavailable proof falls back to full testing. Invalid canonical provenance fails the job. The held release workflow and its proofs are unchanged. Only read permissions were added; there are no new caches, artifact uploads or paid tools.

## Changed paths

- `scripts/sync-shared-chrome.mjs`
- `scripts/check-site.mjs`
- `index.html`
- `websites/index.html`
- `websites/made-for-you/index.html`
- `custom/index.html`
- `custom/scope/index.html`
- `custom/process/index.html`
- `abracadabra/index.html`
- `abracadabra/how/index.html`
- `abracadabra/app/index.html`
- `hive/index.html`
- `solutions/index.html`
- `domains/index.html`
- `work/index.html`
- `about/index.html`
- `faq/index.html`
- `contact/index.html`
- `start/index.html`
- `alakazam/index.html`
- `care/index.html`
- `responder/index.html`
- `services/index.html`
- `404.html`
- `.github/workflows/site-quality.yml`
- `ops/ci-release-proof.mjs`
- `ops/test/ci-release-proof.test.mjs`

## Focused validation and visual review

Shared chrome check passed across 22 pages with zero drift. The existing site and route checks passed. The focused CI test file passed 31 cases, covering the strict control/source Git graph, successful source-proof reuse, invalid provenance, repository/head/tree/job/attempt/step mismatch, API failure and full-run fallback. Original focused stdout `888099ae7af3f2c6df0bebb2f4871d889e2e1fd8b2ec5382771e4501ea6795a2`, tool originals `5eddb38b4c394ed08afdef6f15fcf70f4580f08f2532316d4d447b8f3175a410`.

Local authored-source browser checks passed Home, Alakazam and 404 at 1440 and 390 pixels: exact seven header destinations, mobile menu, current-page state, customer link, readable header/footer text, zero horizontal overflow and successful local static requests. All 15 actual header/footer/menu screenshots were personally inspected at readable size. Browser result `27bf4f751af26d85ef1f4197c48b4cc83def08a1d9ea489564a935a2f518b0e8`, visual/integrity review `df60a5e8f8a48a5444ea5cb889cbdc77b796c2351a45c3fb07c6e9992246d989`. This targeted check was not presented as a built-hosted-artifact or live-site check. The first collector invocation omitted the required viewport `mobile:false` parameter and failed before navigation; its original result `f66cae7d6929eb498d301eb996f65f1a58c86e661829552ccd8328d72c90eb29` remains. Only that outside-repository collector argument was corrected; no source guard changed. Owned browser/profile and loopback server were cleaned.

## Accessible-menu correction

The first complete run on I7094ab17 passed 2622 tests with 33 skips and no test failures, but its final browser audit correctly failed: the synchronized header omitted the explicit Menu accessible label previously present on /websites/ and /websites/made-for-you/. Original failed execution `ba0f70e2f7e1ccf2cbd6147ffec9e7a971365167bf92768b9332383e03475d5e` is retained and its owned scratch was cleaned. It does not qualify the release.

Corrected I2 restores `aria-label="Menu"` in the shared template and all22 nonlegal target headers. This is the sole difference from the preserved prior implementation; exact correction `1e05907ad37d9683be67140c7667b37cb6c1f6a23c3dd175e6db6877c81c7232`, source equality/correction receipt `4fcfcf2ab3fe92320a9e6a4130ccc99f7209a33ba8ae9b2a74a1ba7f8d17584d`. The existing accessibility assertion was not weakened. Actual browser accessibility trees on both failed routes at1440 and390 now report zero unnamed buttons and the mobile menu name Menu; targeted result `b098913aea12199dae9d86e2a0d13c4d6af5d23ae23bf33736f5ade1db2c65be`. Those owned browser resources were cleaned. The earlier 15 visual screenshots and focused31 CI tests are reused because this label-only correction changes no visual styling or CI implementation; they are not relabeled as reruns on I2. Root reviewed the exact correction and froze I2 before authorizing one corrected full run.

## Complete qualification

One corrected complete `npm test` ran on clean exact I from 2026-10-20T17:17:34.525Z to 2026-10-20T17:22:22.623Z, original session25534, exit0: 2655 tests, 2622 passed, 33 skipped and zero failed. Current browser audit passed: 24 hosted routes × 6 required width modes, exact-width layout, including a 720-pixel source at 200% reflow; four-stage account room; mobile menu; complete maker preview; released Alakazam publish/rollback/unpublish with queued-state blocking and refresh; issued-change plus ready-completion fixtures; H1N Purpose-1 customer/owner change-payment journeys; Purpose-2 paid plus zero-balance immutable handoff with exact owner command/document identity; retained document and final-state errors; a delayed-authority zero-write race; keyboard activation; and 44px controls at the required 320, 360, 390, 720-at-200%-reflow, 768, and 1440 width modes. The skips comprise 29 database-dependent checks and 4 retired or superseded Privacy V3 fixtures. No skipped check is claimed to have run.

Pinned Node24.18.0 and the retained Chrome149.0.7827.55 binary were used with existing locked dependencies. Stdout `aa87a6716df169f0354b0197802c01560bd6e900d4c5dbd2000131e47b951838`, stderr `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, execution `99ec8963e2991a2d4dae8080e40de365aac93091a30809c041dbd8b293803db2`, original collection `ba760de4550cfdbda112cbee3d88df6eecfe11247ff769c227e9addbe32c60b9`. The task-owned qualification scratch was removed only after zero remaining owned processes; cleanup `da1db03491e81026acbbddfe0610f2372c46f887d1bf04ead7efcd3a04668705`. Logs and qualified build outputs remain.

## Review and release boundary

Root reviewed the exact integrated CI/workflow logic, navigation invariant and visual evidence before freezing I and authorizing this one qualification. PostgreSQL is not applicable to this cleanup: the exact 27-path change contains public chrome/checks and CI proof reuse only; there are no migrations, database repositories, application business paths, dependencies or native-client changes. No prior database or Android proof is relabeled as a new run.

This is local source qualification. The new GitHub reuse branch was tested with isolated Git fixtures and controlled API responses; its eventual genuine GitHub control run is still separate. No push, PR, production update, provider call or customer message occurred. The private HQ navigation patch remains separate and unapplied.
