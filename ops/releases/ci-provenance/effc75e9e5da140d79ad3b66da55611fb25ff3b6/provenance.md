# External availability and redirect dependency correction — October 20, 2026

Implementation `effc75e9e5da140d79ad3b66da55611fb25ff3b6`, tree `83841a03a1e8d0c1e45cf1866261d33f9725f7df`, base `e7452e932d73f5c709ac76c86506df35a1ad4fbb`.

The public GitHub observer reuses existing independent edge probes for the exact
homepage response, immutable privacy artifact, trusted TLS and live API release,
and additionally requires fresh database readiness for that same release. Fixed
public destinations, bounded bodies/requests, no redirects, read-only repository
permissions, public-only standard runners, no credentials, uploaded artifacts or
cache preserve the zero-spend boundary. Failed samples fail the job; no hidden
retry or automatic target learning occurs. GitHub schedule/notification delivery
is not guaranteed, and its own scheduler still needs a separate dead-man for
complete monitoring coverage. The owner mailbox is not a GitHub delivery claim.

During finishing qualification the registry flagged GHSA-q3jh-wrc6-jgq8 and
GHSA-8r9p-f939-6h3c in transitive follow-redirects1.16.0. Exactly that locked
package changes to1.16.1; direct dependencies, application code and schema do not
change. Two real localhost redirect fixtures prove array-form credential headers
and custom sensitive header names containing regex metacharacters are stripped
across hosts. Original endpoints must receive each fixture credential, and the
public header still reaches the destination, avoiding vacuous passing tests.
Production Twilio imports currently call request-signature validation and JWT
construction; no application call to this vulnerable redirect API was found.
That is an exposure assessment, not a claim that the installed package changed.
The new dependency requires genuine separate Linux staging and native acceptance.

Eight focused tests passed. They also reject stale/unready/wrong-release database
responses, malformed/oversized bodies, altered legal bytes, TLS failure and bad
target configuration before network. Response bodies/errors never enter public
logs. One read-only local public observation passed all five checks at22:02Z;
actual external GitHub execution remains a post-merge acceptance boundary.

The complete clean pinned-Node npm test passed 2639 tests with
33 existing skips and zero failures, including24routes at six
widths. Full log SHA256 `a5c76f093d8fee9d6a38b05222a3b69a7b895fd14481eb4a5ecf83c5de4c58bd`. The initial sandbox-only attempt failed on
localhost EPERM and remains retained. The final source was qualified outside that
sandbox with canonical TMPDIR and the reviewed Chromium; no test was weakened.

Root reviewed fixed egress, bounded/redacted failure output, target pinning,
workflow permissions/cost controls, direct-to-transitive dependency diff and both
credential regression tests. There is no database/query/schema change; separate
PostgreSQL execution is not applicable to this source cohort. Local test servers
closed; browser fixtures cleaned by the passing harness. No production resource,
customer account, customer message or provider transaction was created. The
owner-requested three full security checks remain queued until the system is
finished and running; this targeted correction is not counted as one of them.

