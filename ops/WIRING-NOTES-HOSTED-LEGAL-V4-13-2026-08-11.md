# HOSTED-LEGAL-V4-13 wiring notes

Status: held repository wiring only. This packet does not publish, deploy,
change DNS, call a provider, create a release receipt, or authorize a customer
effect.

## Canonical hosted projection

`npm run build:hosted:legal-v4` builds the complete hosted artifact at
`_hosted`. It preserves every ordinary hosted allowlist entry and derives its
legal additions only from the immutable V3 and V4 finalization receipts:

- V2 Privacy and Website Terms version URLs remain the immutable ordinary
  hosted sources;
- V3 Privacy and Website Terms version URLs come from the retained joint V3
  release receipt;
- current Privacy, Website Terms, and Legal Center aliases plus both V4
  version URLs come from the retained joint V4 release receipt.

`npm run check:hosted:legal-v4` is read-only. It checks that exact file ledger,
the retained legal bytes, hosted transforms, and all existing commerce,
Alakazam, provider, and publication holds, then validates the HTML. Artifact
count and manifest identity are derived from the completed tree; they are not
new source constants or release authority.

## Held CI ordering

The held release workflow first completes `npm test`, which intentionally
leaves the ordinary hosted build in `_hosted`. It then builds and checks the
Legal V4 Pages projection and replaces `_hosted` with the complete hosted V4
projection. The final CI verifier consequently recomputes the origin manifest
from the same `_hosted` tree that Caddy is configured to serve.

CI-BROWSER-CONTRACT-12 also owns the adjacent Pages/browser proof steps in
`.github/workflows/ci-release-proof-held.yml`. Integration must retain that
packet's browser command/details changes and this packet's complete hosted V4
build/check step. Required order is:

1. full `npm test`;
2. Legal V4 Pages build/check;
3. complete hosted V4 build/check;
4. successor-bound Pages manifest/browser receipts;
5. PostgreSQL proof and cleanup;
6. final origin and CI verification.

No successor input should bind the ordinary hosted artifact or the retained
five-file V4 overlay. The release authority must bind the manifest derived
from the complete `_hosted` projection built from the exact candidate.
