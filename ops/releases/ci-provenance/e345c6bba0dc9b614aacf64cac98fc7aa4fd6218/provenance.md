# Automatic service notices and ordinary payment completion — October 20, 2026

Implementation `e345c6bba0dc9b614aacf64cac98fc7aa4fd6218`, tree `e5c1075784529c1ec55863a7a750f05b1dd13339`, base `b2e4b5eb6480f6e96b50eb9168df66d3d88b51ef`.

The approved service-mail delivery configuration is already active. This change
connects39 missing ordinary source actions to the existing45-template system:
support5, commerce21 and other service purposes13. Existing Care catalog5 and
explicitly requested HQ follow-up1 remain within their approved scope. Each new
eligible source event reserves mail and its outbox work in the same transaction,
with canonical recipient lookup, digest-only durable mail content, stable source
deduplication and the existing private renderer. Removed, ineligible or durably
suppressed recipients are skipped; unexpected storage/render errors roll back
the business action. There is no historical sweep, additional template or schema
change. Care catalog suppression is checked before its event is inserted, so a
known suppressed recipient does not block an otherwise valid business action.

Normal final-payment and handoff acceptance exposed SELECT FOR UPDATE against
immutable source tables on which the service role correctly has SELECT only.
Five reads now use their existing same-transaction per-job H1M advisory lock;
settlement retains the mutable checkout-attempt row lock. Scope, immutable
source/digest equality, command identity, clearance and concurrency checks remain.
No database grant was widened and all110 migration files remain unchanged.
Operator payment notices require an explicit capable canonical recipient, with
no arbitrary fallback. Native API recipient alignment is a separate reviewed
deployment prerequisite. Support screens describe a recorded email notice;
they do not claim provider delivery.

The complete clean pinned-Node npm test passed2688 tests, with37 optional
database skips and zero failures, including24 hosted routes at six widths.
Actual PostgreSQL coverage was separately executed; skipped tests are not
represented as database passes. Full log SHA256 `970f3fe44f90679b34b30c2363f09e4d3b766093133f646ea7878579a179aa96`.
The final16 focused payment/handoff cases passed, log SHA256
`0dc3e22df5914869ca8f55115d762defc9234d59e1da620d1e3961687bb219c0`. Actual database aggregate SHA256
`1483217510fe37100aa872ef25976ccd15f5d173f31261831a9ccc26210287a4` binds support, commerce, purpose, Care,
Alakazam publication and the complete Assessment-to-Custom journey. Fixtures
verify ordinary action/replay, private rendering, suppression, atomic rollback,
and pending mail without dispatch or real provider traffic. Normal final
payment/handoff produces exactly two notices inside an independently rolled-back
savepoint before the original raw-source concurrency checks. All15 customer
commerce notice kinds and ordinary project-progress/publication notices are
covered. Initial fixture failures and the resulting immutable-lock defect are
preserved alongside the successful corrected proof; no failed result is hidden.

Root integrated the four isolated reviewed changes and verified the unchanged
migration, environment schema, worker, legal and ingress contracts against the
accepted runtime seal. The bounded final immutable-read review is bound by
SHA256 `a33351884072315fffa6330ff3f46b3e93d0f3844066ef18349a0e84831ce7fc`. All owned disposable test databases
were removed with ownership and zero-session checks, without FORCE; actual
cleanup receipts are linked in the database aggregate. Browser/test fixtures
closed through the passing harness. No customer account, real provider payment
or additional real message was created by this qualification.

The running system has not yet received these changes. Exact protected source,
held release proof, native recipient alignment, installation and runtime
acceptance remain required. The owner's three full security checks remain
queued until the finished system is running; this functional qualification is
not counted as any of those checks.
