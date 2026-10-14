# Repair the assembled publication runtime

Implementation `95ba59cc6e700a91adf535515bea502e94fea7ed`, tree `5b4e05dd930cd783c9a1a8b805e1e277dde5133e`, direct protected base `3090d72e4fda0324f5797e47f43916b9c2f3208a`.

The actual HQ API failed startup because the Alakazam wrapper omitted the base publication port's required `purgeProject` runtime method. Forwarding that method with its bound receiver fixes construction; forwarding the resulting port method preserves terminal erasure. Only the wrapper and a real-runtime regression changed. No schema, database implementation, provider mode, dependency, public copy or deployment policy changed.

The two new regressions failed on the original code with the production configuration error. All 24 focused tests then passed. They compose the real SelfHostRuntime and default base port, verify readiness under a publication hold, and prove filesystem erasure, dark serving after reopen, idempotent replay, conflicting identity rejection and prevention of later publication. Root reviewed both forwarding boundaries and the real-runtime regression. The fix files are byte-identical to original worker commit e16574a4a42bb8d761dbfe07de09697366ab2aee; the release implementation adds them to current protected main so the ordinary PR graph retains its existing control evidence.

## Actual validation

- Complete `npm test` on this exact implementation exited 0: 2,506 passed, 26 skipped, both builds and the browser audit of 24 routes at six widths. Original full log SHA-256 `0c363f4b0ed06331f5d3a10ffcfd542f812ff013a52ef1c1bf2add7617dd6007`.
- Focused log SHA-256 `3df6496375bf20c0fa405a2086f3e883c9b19a715d8b12d5a42e527249851884`. Original red and initial macOS noncanonical temporary-path failure remain retained. The corrected focused invocation used canonical TMPDIR; no product workaround was added.
- Actual full hosted-process startup on HQ at 2026-10-14T16:18:30Z passed health/live/ready200 and clean exit0 on isolated schema106 clone OID89882, with only loopback networking and the original production socket hidden. Receipt SHA-256 `21df1d493bf0be762887bd4f3514fecaa9e34e361985785c1b91c3b6396983d9`. This earlier proof overlaid the exact fixed file on historical C660 and kept its genuine original anchors; it proves the repair, not qualification of this new candidate. The final unmodified protected candidate still requires its own genuine-anchor startup check before handoff.
- First full-suite attempt failed one existing archive-permission fixture because the external runner inherited umask077. Original failed log SHA-256 `77e6b0d7443b05e75626e60025cc1d94879ab67e1a58a595421a3d7821020a1f`. The successful runner uses child umask022 while keeping its outer evidence and scratch private. Application source was unchanged by this correction.
- All owned local test processes exited and temporary fixtures were removed. No local test database was created. The stopped native smoke fixture and clone89882 remain explicitly retained for the next final-candidate check; they are not falsely reported as deleted. Existing PostgreSQL, production databases, toolchains, source and evidence are preserved.

## Remaining release work

Public production was recovered to old1126/schema102 after the previous startup failure; migrated106 remains retained with connections disabled. Existing private HQ and its owner are restored. New HQ services remain held and stale106 activation markers are revoked. This source proof does not deploy or activate anything. Ordinary protected GitHub candidate/control checks, actual held qualification, unmodified-candidate startup, fresh changed-state custody, final HQ/public handoff and R5–R8 acceptance remain open. No charges, provider mutation, DNS change, spending or crypto effects occurred.
