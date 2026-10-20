# Typed native release authority — October 20, 2026

Implementation `34f41e08807357dfd9a52ddf5f174c62be9c829d`, tree `63ba424e20ae037ec9953d98619d2257934b58e4`, base `f9b315959a90b02427147f0622b1efa6d87065d3`.

The two accepted presentation/schema-change authority constructors are consolidated
into one maintained local command with explicit typed modes. Candidate, schema,
worker and hold bindings are data. Original CI log receipt, staged manifests,
installed predecessor, migration provenance, held writers, backup/recovery links,
fresh observations and canonical epoch checks are retained. The CLI emits only
held local authority and never performs a production cutover.

Validation: six focused typed-input tests passed. Disposable offline rehearsals
of both accepted modes reproduced all six canonical files byte for byte. Eight
negative cases (unknown field, wrong candidate tree, stale observation and changed
receipt in each mode) refused with no output directory. Original input/receipt
bytes were retained; only derived copies were removed. Rehearsals used recorded
time in the pure constructor; the CLI has no clock override.

The complete `npm test` qualification passed:2628passed,33existing skips,0fail,
plus24routes at six widths. The original attempt failed on unchanged filesystem
checks because macOS TMPDIR traversed a symlink; it is preserved. One corrected
run used canonical `/private/tmp`, with no source changes or guard relaxation.
Its log SHA256 is `8c2ee01c9fcfa711b4cf7eb0598905e0b79e36bc0b7474432a553e8c6cc7edb8`. PostgreSQL schema/queries and application
runtime are unchanged; no additional live PostgreSQL proof is applicable.

Root reviewed strict fields, input custody, finite authority, both writer policies,
source/CI lineage and compatibility fields. Native staging/migration/install/service
adapters remain separately reviewed boundaries; their complete parameterization
is still open. This change is not an automated deployment or whole-system finish.
No provider action, service restart, database mutation or new spending occurred
in this source qualification. The separately authorized mailbox task is not part
of this source diff.
