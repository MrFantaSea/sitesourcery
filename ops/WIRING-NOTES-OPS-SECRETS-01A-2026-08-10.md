# OPS-SECRETS-01A wiring notes

## Added boundary

- `ops/credential-topology.mjs` defines the exact 21-record held inventory,
  strict metadata normalizer, canonical digest, completeness verifier, and
  non-secret held template. The same authoritative module now derives current
  Stripe adapter operations and verifies the three existing Stripe records;
  no parallel Stripe topology or evidence receipt is introduced.
- `ops/credential-topology.schema.json` permits only the reviewed metadata
  vocabulary and no arbitrary strings or properties.
- `ops/verify-credential-topology.mjs` reads one explicitly supplied absolute
  JSON path. It reads no environment, Keychain, browser, host-secret path, or
  provider state, makes no network call, and spawns no process.
- `ops/test/credential-topology.test.mjs` proves exact inventory, held output,
  revocation/overlap gates, environment/custody separation, two-operator
  recovery, future-time rejection, and rejection/non-echo of secret-bearing
  fields.

No database migration, runtime composition, service unit, environment example,
provider configuration, release switch, or deployment root is changed.

## Later composition boundary

A future release-readiness packet may import `verifyCredentialTopology` and
pass it a sealed non-secret manifest. It must preserve these rules:

1. The manifest is evidence input, not secret storage or provider authority.
2. Runtime, deploy, or provider environment values must never be passed to the
   verifier.
3. The release gate must require `topologyEvidenceComplete: true` and the exact
   expected topology digest, while independently retaining all commercial,
   mail, tunnel, DNS, and deployment holds.
4. `effectsAllowed` must remain `false`; a separate owner receipt and exact
   product/provider gate are still required.
5. Evidence freshness must be an explicit release-packet decision. This v1
   contract rejects future timestamps but has no invented maximum age.

## Known successor and residual code work

- Identity prior-pepper code support is verified at exact successor commit
  `88df3f6b8ebc8ba5f17279cae484115472b070f8`. This packet does not cherry-pick
  it and does not infer installed current/prior material from it.
- The base Stripe composition accepts one webhook signing secret. A separate
  bounded code packet must add current/prior verification before the topology
  may claim `overlap`; until then the safe path is held or a separately proven
  prior revocation.
- The Resend transport accepts one configured credential. A separate
  composition packet must bind distinct production/staging stores and
  environment-specific transport construction before the separation control
  can be proven.
- The registrant vault and Cloudflare held unit establish code/configuration
  boundaries only. Their material presence remains an external, secret-blind
  attestation fact.
- Backup custody remains governed by
  `sitesourcery.backup-restore-contract/v1`; this topology adds no decrypt,
  copy, retention, restore, or cleanup permission.
- Dual-operator recovery is policy/evidence only here. No generic recovery,
  delete, rotate, mark-ready, or provider command is introduced.

## Integration proof

After cherry-picking this packet, run with the repository-pinned Node version:

```text
node --check ops/credential-topology.mjs
node --check ops/verify-credential-topology.mjs
node --test ops/test/credential-topology.test.mjs
npm run check:ops
```

Do not run a provider CLI, secret-manager command, Keychain command, browser
automation, live-environment dump, tunnel command, or deployment command as
part of this packet.
