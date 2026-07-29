# Private publication and rollback port

Hosted publication calls `server/selfhost` in process. The hosted HTTP router
does not expose release installation, hostname reservation, activation,
rollback, or gate mutation. A public `Host` request can only ask the self-host
runtime to serve a previously activated immutable release.

The port requires one internally assembled proof packet that binds:

- the active, safety-clear project;
- the exact release request, project, address, accepted version, and passed
  pre-publication screening;
- an active or unexpired-grace paid subscription;
- the current configured and verified address; and
- the canonical server compiler schema/revision, server-generated HTML bytes,
  and the matching version and screening SHA-256 digests.

A release-request row by itself has no serving authority. The global
`PUBLICATION_HOLD` is checked before any mutation. If it is already set, the
port returns `held`, writes no release or hostname control state, and removing
the hold later cannot publish that request. The request must be dispatched
again after the hold is deliberately lifted.

Installation writes an immutable release first. Hostname activation and
rollback then use the self-host control store's compare-and-set revisions. A
target hostname is held while its TLS and release binding are changed, so an
interrupted update fails dark. Unpublish is intentionally still available
during an emergency publication hold.

The hosted service never calls the publication runtime from inside the
transaction that stages a release request. It first commits the exact request,
loads the committed proof in a read-only transaction, asks the private runtime
to publish, and then records the bound provider receipt and completes the
release in a separate serializable transaction. Customer success is returned
only after that final transaction commits.

If finalization or its commit fails after runtime activation, the service
immediately calls the private unpublish operation before returning an error.
That leaves the hostname dark. Replaying the same customer command reuses the
committed staged request, the runtime's release-request idempotency identity,
and the exact receipt tuple, so it can safely reconcile without creating a
second release request or incrementing the project revision twice.
