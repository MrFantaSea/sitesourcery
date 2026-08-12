# Untouched base baseline

Observed: 2026-08-12T01:03:45Z  
Base SHA: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`

## Exact environment

| Input | Identity |
|---|---|
| Node | `24.18.0`; SHA-256 `ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a` |
| npm | `11.16.0` from the retained Node 24 distribution |
| Chromium headless shell | `149.0.7827.55`; SHA-256 `11e393326c7d20a7c56641a7c65def33ea9c280da3b0b74cf8563b07989a0ee3` |
| `package-lock.json` | SHA-256 `eb38b526ab5dc081dec3e7c2e06e260401050f5872c7da43c55349e529328356` |

The Mac default `/opt/homebrew/bin/node` is `26.7.0` and is not valid for this release. Every release command must prepend the retained Node 24 `bin` directory or use an equivalent exact-runtime wrapper.

## Baseline result

- `npm ci --ignore-scripts`: passed; 41 packages installed.
- First aggregate attempt: correctly failed at `runtime:check` because npm child scripts resolved the Mac Node 26 default. No source changed.
- Corrected exact-runtime aggregate `npm test`: passed from the clean base, including runtime, static/content/catalog/legal, Node, public-truth, self-host, hosted-service, operations, public/hosted artifact, and Chromium browser gates.
- Worktree remained clean after the aggregate run; `_site` and `_hosted` are generated/ignored artifacts.

## Classified baseline defects

1. The release needs a durable exact-Node launcher/environment contract; relying on the interactive shell default fails closed.
2. `npm audit` reports two high transitive development-tool findings:
   - `brace-expansion` 5.0.8, GHSA-rgw5-rvv9-x895.
   - `fast-uri` 3.1.4, GHSA-7p8r-x3mc-p8w7.
3. The preserved union already upgrades `html-validate` from 10.17.0 to 11.6.2, removes the vulnerable brace-expansion path, and locks `fast-uri` 3.1.5. Phase 2.1 must import and re-audit that exact dependency change before acceptance.
4. The base's catalog/legal/UI projections conflict with the selected canonical commercial source. Catalog repair belongs to the declared catalog cohort and may not be hidden inside baseline dependency work.

No public site, runtime service, database, DNS, provider, or external effect changed during this baseline.
