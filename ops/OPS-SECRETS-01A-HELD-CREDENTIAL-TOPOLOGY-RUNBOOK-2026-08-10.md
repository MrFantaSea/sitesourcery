# OPS-SECRETS-01A held credential-topology runbook

## Status and boundary

This packet defines a secret-blind evidence contract. It does not authorize or
perform credential creation, inspection, copying, rotation, revocation,
recovery, provider access, Keychain access, browser access, environment
inspection, host inspection, deployment, DNS, tunnel, mail, or payment effects.

The contract is `sitesourcery.credential-topology/v1`. Its only mode is
`held`, and every verification result reports `effectsAllowed: false`, even
when all non-secret topology evidence is complete.

The verifier accepts one explicit JSON file containing only exact logical
names, non-sensitive kinds, purposes, bounded scopes, logical storage
boundaries, rotation states, last-proven UTC timestamps, SHA-256 evidence
digests, material-presence booleans, and the three reviewed non-secret Stripe
provider bindings. Those bindings reuse the existing Stripe item records and
add only account/mode, key class/version/fingerprint, enabled purposes, and
activation/revocation chronology. It does not accept credential values,
provider prefixes, Keychain contents, browser DOM, raw provider responses,
commands, or raw evidence documents.

`materialPresent: false` on an `unproven` or
`compromised_pending_revocation` record means only that this manifest makes no
usable-material claim. It is not evidence that material is absent. A revoked
state requires its own timestamped digest evidence.

## Code support versus live proof

The repository can prove code shape without proving that any credential exists:

| Boundary | Code support | Runtime/custody proof |
| --- | --- | --- |
| Stripe restricted runtime | The hosted Stripe configuration rejects Standard/full/shared authority and requires a mode/account/fingerprint-bound restricted key with the exact enabled-purpose scope union. | **Not proven.** No key presence, restriction, storage, or provider state was read. |
| Stripe webhook rotation | The base runtime verifies one configured signing secret. | **Not proven and not overlap-ready on this base.** A later packet must add bounded current/prior verification before overlap can be claimed. |
| Stripe provisioner and compromised Standard credential | The reviewed readiness document separates the short-lived provisioner from runtime and records the Standard live credential as compromised pending authenticated revocation proof. | **Not proven.** Both records are status only; neither is runtime authority. |
| Resend | The transport has a bounded API contract and provider readiness response. | **Not proven.** This base has one credential input, no production/staging separation receipt, and no revocation proof for any historical shared full-access credential. |
| Identity peppers | Prior-pepper production composition is code-verified in successor commit `88df3f6b8ebc8ba5f17279cae484115472b070f8`. | **Not proven.** No current or prior material presence, custody, overlap, or revocation fact was read. |
| Backup age custody | The held backup/restore contract already accepts only non-secret custody and recovery-access digests. | **Not proven.** No age identity or ciphertext location was inspected. |
| Registrant encryption | `createAesGcmContactVault` implements AES-256-GCM with a versioned key boundary. | **Not proven.** No production key presence or custody fact was read. |
| Responder private material | The operation-bound vault implements AES-256-GCM with exact AAD, one current key, and at most one prior decryption key. | **Not proven.** No production key presence, custody, overlap, or revocation fact was read. |
| Twilio Responder API/signature | The worker transport requires a restricted API key and the future callback ingress requires separate signature-verification material. | **Not proven.** No Twilio credential, provider binding, or secret value was read. |
| Cloudflare Tunnel | The held service/configuration names one dedicated logical connector credential boundary. | **Not proven.** No credential file or Cloudflare state was read. |
| Operator recovery | The topology requires distinct requester and approver custody plus a dual-control receipt. | **Not proven.** No operator credential, identity, or recovery path was inspected. |

The identity successor commit is evidence of code support only. It is not
credential-presence evidence and was not cherry-picked into this data-driven
packet.

## Exact owner checklist

- [ ] Confirm the 26 logical records exported by
  `CREDENTIAL_TOPOLOGY_CONTRACT.names` are the complete launch inventory.
- [ ] Confirm the held Stripe runtime inventory matches
  `STRIPE_RESTRICTED_KEY_CONTRACT.allRuntimeScopes`, the maximum union for all
  supported non-Domain purposes. Separately require the installed runtime
  record to narrow that inventory to the exact enabled-purpose union and to
  reject Standard/full-access/shared credentials. Domain write scope remains
  absent from both contracts.
- [ ] Keep the compromised Stripe Standard record status-only until
  authenticated, non-secret revocation evidence exists; never reuse it for a
  runtime or provisioning purpose.
- [ ] Require the short-lived Stripe provisioner to have its own bounded scope
  evidence and separate revocation evidence before marking it
  `ephemeral_revoked`.
- [ ] Select either verified current/prior Stripe webhook overlap or verified
  prior-secret revocation. Do not select overlap until runtime code accepts and
  tests both slots.
- [ ] Require distinct Resend production and staging credentials, storage
  boundaries, and a non-secret separation receipt. A shared full-access
  credential is forbidden.
- [ ] Keep the historical shared-full-access Resend record status-only and
  incomplete until a separate revocation receipt exists. It is never sender
  authority.
- [ ] Confirm current/prior identity pepper version policy, overlap duration,
  and the evidence required before prior revocation. Code support at `88df3f6`
  does not prove material is installed.
- [ ] Confirm the Responder material current/prior version policy, separate
  non-secret rotation evidence, and prior-key revocation boundary. The prior
  key may decrypt only and at most one prior version may overlap.
- [ ] Require distinct Twilio restricted API and webhook-signature logical
  records. Neither record may be shared with Stripe, Resend, registrant,
  Responder-material, identity, backup, or tunnel purposes.
- [ ] Confirm the sole recovery-capable age identity is outside every
  ciphertext store and outside Zen; approve only digest references to custody
  and recovery-access evidence.
- [ ] Confirm the registrant-contact encryption key has a production custody
  boundary and version policy separate from database ciphertext.
- [ ] Confirm the Cloudflare Tunnel connector credential is dedicated to the
  production tunnel and held in the Dell tunnel-secret boundary.
- [ ] Name two distinct operator recovery roles and distinct custody
  boundaries: requester and approver. One-person recovery is forbidden.
- [ ] Define the maximum acceptable age for later activation evidence in the
  release packet. This held v1 verifier rejects future timestamps but invents
  no freshness SLA.
- [ ] Approve no provider or production effect merely because the topology
  verifier reports complete.

## Exact operator checklist

1. Start from `createHeldCredentialTopologyTemplate()` and write only an
   immutable non-secret JSON evidence input. Do not paste, hash, transform, or
   inspect any credential value for this contract.
2. For each active/revoked record, obtain a separate non-secret attestation
   that states only the logical record name, reviewed scopes, logical storage
   boundary, rotation result, and proof time. Store only the attestation's
   SHA-256 digest in the topology input.
3. On `stripe.runtime.production.restricted`, store the exact enabled-purpose
   scope union in the existing `scopes` field and use existing
   `lastProvenAt`/`evidenceDigest` for its provider scope readback. Its
   `providerBinding` contains only production/live account ID, restricted key
   class, non-secret version/fingerprint, activation time, and enabled
   purposes. This proof must be refreshed within 15 minutes of readiness.
4. On `stripe.provisioner.production.restricted`, retain the existing custody,
   scopes, `ephemeral_revoked` state, `lastProvenAt`, and `evidenceDigest`; the
   latter pair is revocation evidence. Its `providerBinding` adds only the
   non-secret account/key binding, activation/revocation times, and the distinct
   scope-proof time/digest. The active lifetime cannot exceed 24 hours.
5. Keep `stripe.standard.production.compromised` at
   `compromised_pending_revocation` until a real revocation attestation exists.
   Then set `compromised_revoked`, `materialPresent: false`, and bind its proof
   timestamp/digest plus the status-only non-secret `providerBinding`. Never
   put Standard key material or a hash derived locally from key material here.
6. For Stripe webhook rotation, prove the current record and either:
   - mark the prior record `overlap` with material-presence evidence and bind a
     `proven` rotation-control receipt; or
   - mark it `revoked` with absence/revocation evidence and bind the same
     control receipt.
7. Repeat that evidence shape for the current/prior identity peppers. Use the
   successor commit only for code-support evidence; obtain separate material
   and custody evidence.
8. Prove Resend production and staging use their two exact distinct logical
   storage boundaries, bind a `proven` separation-control receipt, and set the
   historical shared-full-access record to `shared_revoked` only with a
   separate timestamped digest.
9. Prove the current/prior Responder material keys and their rotation control
   with three distinct non-secret evidence digests. Prove the Twilio restricted
   API key and webhook-signature records independently without reading either
   value.
10. Prove the backup identity is held in
   `independent-off-zen-recovery-custody`, ciphertext is held in
   `zen-off-machine-ciphertext-store`, and bind their separation-control
   receipt. Never inspect or move either artifact in this verification step.
11. Bind presence/custody evidence for the registrant encryption key and the
   Cloudflare Tunnel connector without reading either value.
12. Bind distinct requester and approver recovery evidence plus the dual-control
    receipt. Stop if one operator can both request and approve recovery.
13. Run the read-only verifier using only an absolute path to the non-secret
    JSON input:

    ```text
    node ops/verify-credential-topology.mjs \
      --input /absolute/path/to/nonsecret-credential-topology.json
    ```

14. Preserve the verifier's topology digest and blockers as non-secret release
    evidence. Exit status `2` means the input is valid but incomplete; `1`
    means the contract is invalid. Exit status `0` still leaves every effect
    held.

## Mandatory failure conditions

Stop and leave the packet held when any of the following is true:

- any record proposes full-access scope;
- a credential is shared across Resend production and staging;
- the only recovery-capable age identity shares a storage boundary with
  ciphertext;
- current/prior webhook or identity-pepper overlap/revocation lacks exact
  timestamped digest evidence;
- the ephemeral Stripe provisioner lacks revocation evidence;
- the compromised Stripe Standard credential lacks revocation evidence;
- operator recovery lacks either requester, approver, distinct custody, or the
  dual-control receipt;
- evidence is future-dated, incomplete, shape-drifted, or contains any field
  outside the exact metadata vocabulary;
- proving a fact would require opening a secret store, reading an environment
  value, inspecting a browser, calling a provider, or putting material in a
  command argument or log.

## Rollback boundary

Verification is read-only and has no rollback action. A rejected input is
discarded or corrected only through a new immutable non-secret evidence file.
No failure permits credential rotation, revocation, deletion, copying, provider
mutation, service restart, deployment, DNS mutation, tunnel activation, or
release-switch change.
