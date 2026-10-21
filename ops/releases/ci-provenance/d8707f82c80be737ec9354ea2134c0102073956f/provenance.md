# Authentication and service isolation preparation — October 21, 2026

Implementation `d8707f82c80be737ec9354ea2134c0102073956f`, tree `bd62a04ad35332b910898654f662e7a79ce5ad25`, base `9ea58903563368d4e78c99811e19ce7e4ef4ffcc`.

Sign-in and recovery now apply existing subject, trusted-client and global
admission before expensive hashing. Invalid recovery tokens fail cheap eligibility
checks; final locked token, delivery and credential revalidation remain. Admitted
missing/inactive accounts perform one dummy verification, and successful sign-in
clears only its subject budget.

Readiness and exact legal-authority reads use bounded read-only service
transactions. This supports non-inheriting, non-administrative database logins
without adding direct application-table grants. Existing application service-role
authority is intentionally retained. The stale legal readiness test fake was
aligned with this transaction boundary; catalog/data assertions are unchanged.

Runtime filesystem configuration accepts explicitly paired UID/GID identities for
exports, heartbeat and publication IPC while retaining private defaults. Shared
exports retain immutable digest/replay checks; heartbeat is read-only to API and
publication still requires its bearer token. Same-schema release authority permits
only an explicitly pinned delta for three changed worker source files, preserving
untouched contracts and native pre-write validation. The canonical gateway factory
adds scoped public HTML CSP. Normal preview behavior and eight blocked directive
classes were checked in a real browser.

Complete `npm test` passed 2704 cases with 38 optional
PostgreSQL skips, zero failures, and 24 hosted routes at six widths. Log SHA256
`a77964a2f61a13dcdeb303932e6a14c7fc1086f527c691e8f795e87b38961992`. It ran on integration `ae9e63024db72ea2d6f6d90b801b680cddccbec9`, with identical tree `bd62a04ad35332b910898654f662e7a79ce5ad25`. Canonical
implementation changes only history metadata to retain the required one-parent
provenance graph. Equivalence receipt SHA256
`d3cac84e24e3a2b48371a7a15813bfca8e44a0fd9176efd5e2c0edcba8e1dfa5` preserves both identities and
original evidence. Initial missing npm path, macOS temporary-path alias and stale
fixture failures are retained.

Separate actual PostgreSQL proof passed 25 authentication and four database-role
cases (including parent cases), with no skips or failures. Aggregate SHA256
`7747a65b33355fd7757a61cfc087b4e8f8d4bd3b2bfd9702ba094aaa8a72a22f` binds exact matching source
bytes and owned fixture cleanup. It covers credential races, replay/stale tokens,
intended application access and denial of database administration, server-file
and command access and foreign-tenant reads. It does not prove production
SCRAM/HBA. Broader unchanged commercial database evidence remains historical,
not newly executed here.

The native Linux synthetic rehearsal passed all 15 checks with separate numeric
identities, no network connectivity and no production data. Required export,
heartbeat, publication and tenant reads worked; tested unauthorized reads and
writes failed. Its owned fixture was removed; receipt SHA256
`58931af85a0e69b85432fd31cf01ae4e247e8ca3e72372f875f82fdfe7069fd6`. Authentication, database and all 19 runtime-source
files received independent bounded review. Root reviewed the five CSP paths and
integrated fixture correction. Review hashes: `ac2f19320e4953f35653d5d7e5cd8c3292ffe5485e8aa95998251fadc5488dd8`,
`4245a953384a8f008d8f03cefcb32e983c7762d2911fa34a1ff4c5cf3e567c29`, `9ed905c8fbe7eb1a6447b8ee7ee8cf181ebc3033d86945c4779aa60ccac2b139`.

These are prepared source remedies, not live security acceptance. Three full
initial reviews began after running-system acceptance and found issues. Dedicated
production identities, network/filesystem isolation, database authentication and
privilege cutover, actual Caddy header configuration and installed independent
verification remain separate native steps. No migration, new real message,
provider payment, customer creation or production configuration change occurred
in this qualification. Application-wide service-role access and the trusted host
kernel/operator remain explicit limits; no absolute security guarantee is claimed.
