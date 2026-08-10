# READINESS-01 integration notes

This packet changes no production composition, provider mode, monitor URL,
origin unit, environment contract, or customer capability. The existing
`/api/v1/health` and `/api/v1/ready` paths remain compatible. `/api/v1/live` is
additive.

## Release identity

The hosted API defaults honestly to an `unbound` release identity. At the
existing `createHostedApi(service, { ... })` production composition call, pass
`releaseIdentity` only from the already validated release-epoch object:

```js
releaseIdentity: {
  schema: "sitesourcery.hosted-release-identity/v1",
  state: "bound",
  epochId: verifiedEpoch.epochId,
  bindingSha256: verifiedEpoch.binding.sha256,
  publicArtifactCommitSha:
    verifiedEpoch.binding.artifact.publicArtifactCommitSha
}
```

Do not parse the epoch file in the HTTP module and do not manufacture these
values from environment strings. The composition owner must keep the existing
release-epoch verifier and startup failure behavior authoritative. This packet
does not claim that a production epoch is installed.

## Readiness boundary

The default policy is a 750 ms dependency deadline, 1,000 ms cache TTL, and
5,000 ms stale window. The HTTP boundary calls the existing complete
`service.readiness()` check, so all current PostgreSQL, Stripe, Resend, domain,
publication, and legal verification semantics are preserved. The cache only
limits repetition and never converts a negative, failed, timed-out, or stale
check to ready.

If an integration lane overrides `readinessPolicy`, use only reviewed integer
values within the module bounds.

Customer `/api/v1/capabilities` and loopback
`/_sitesourcery/operations-state` retain their existing authorities and shapes.
Neither liveness nor dependency readiness grants customer effects. Caddy,
origin-seal, and independent-monitor consumers may continue using their
retained probe paths without changes.
