# Correct release abort handling and HQ startup protection

Implementation `a8c6d503af6349c946132f3346f4255505015160`, tree `144103daeff0b9cdaa41727b4a46711b787e9cb8`, direct protected base `493ce176f4cfa15c38720356756e381403e6d3e1`.

Actual held GitHub run 38054725323 failed when the anchored writer rejected after an abort signal but before the caller attached its handler. Completion is now observed immediately while the original promise still propagates ordinary failures. The deterministic regression reproduced the original unhandled rejection, then all 43 affected tests passed. The failed run and original candidate remain retained.

The three HQ process units explicitly preserve shared-account IPC and run the existing pinned, root-owned, read-only storage guard before application runtime checks. Source validation rejects missing, duplicated, late or altered guards and unsafe IPC settings. Two bounded transient probes executed the guard on actual HQ under API and worker namespace restrictions, without elevated privileges. Both returned healthy and exited 0; transient units were collected and PostgreSQL/private HQ PIDs remained unchanged. Probe receipt SHA-256 `66981efebb154994bca50b04c7e9b996ae867447e8a69e81ed1a3760091ca2f4`. Optional absent candidate paths limit this to guard compatibility, not installed application acceptance.

## Validation

- Complete npm test on the exact implementation exited 0: 2,504 passed, 26 skipped. Browser audit passed 24 hosted routes at six width modes. Full log SHA-256 `54ad25d54365479277e85b5d33f6499bba0695244e41ffe1e060db09ba48a2b7`.
- All 13 HQ profile checks passed, including adversarial guard and IPC mutations. Focused log SHA-256 `b09d069376b63dce25679a27ec1da83ba28adf13e0db23c701e7937bd3578aca`.
- Root reviewed the seven-path delta, including preserved error propagation, exact first-prestart requirement, narrow guard-path exemption and unchanged application/database/dependency/artifact source. The earlier scoped database proofs remain retained; this correction contains no database code or migrations. The actual held release still must execute its combined PostgreSQL journeys.
- All test processes exited. The 52 owned top-level temporary fixtures were removed; private scratch is empty. No database was created for this correction. Existing PostgreSQL, dependencies, toolchains and evidence remain intact.

## Deployment limits

This is locally qualified source, not a deployment. The previous Linux candidate remains inactive and its unchanged dependencies/artifact can be reused. Public production remains old1126 with 102 migrations. New protected candidate/control, successful held CI, native installation/data observations, backup/rollback and public cutover remain required. R5–R8 remain open. No provider mutation, charge, DNS change or spending occurred.
