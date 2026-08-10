# Held identity-pepper rotation and retirement runbook

This is a zero-downtime plan, not authority to execute it. Secret material must
never enter argv, logs, test fixtures, screenshots, evidence, tickets, shell
history, or this document. Use only the approved interactive root-owned
credential procedure, with the hosted environment file remaining mode `0600`.

## Invariants

- Exactly one current version writes every new credential.
- Verification accepts the current version plus at most three explicitly named
  prior versions.
- Version names are metadata; secret values are never readiness evidence.
- Duplicate versions, reused secret slots, reused material, missing secrets,
  malformed base64, unknown slots, and an absent or malformed config stop
  startup.
- A prior reader is never inferred from database contents.
- Removing a prior reader does not modify PostgreSQL. Retirement is a config
  change allowed only after the read-only fence below returns zero.

## Adopt the versioned config without rotating

Before any rotation, deploy a held candidate whose `current.version` exactly
matches the already configured writer version and whose `prior` list is empty.
Keep the existing `SITESOURCERY_IDENTITY_PEPPER` bytes unchanged. The prior
composition default was `v1` only when no explicit version was set; do not
assume that default describes a live installation. Determine the non-secret
version from approved configuration evidence, never by inspecting material.
This adoption step must change metadata only.

## Prepare an overlap candidate

1. Record the currently deployed source/release identity and rollback target.
2. Choose a new non-secret version label. Do not create or expose material in
   this runbook, a command argument, or evidence.
3. Through the approved credential procedure, prepare a new root-owned hosted
   environment for the green candidate:
   - new material occupies `SITESOURCERY_IDENTITY_PEPPER`;
   - the old current material occupies one allowed `_PRIOR_1` through
     `_PRIOR_3` slot;
   - the v1 JSON names the new version as `current` and the old version once in
     `prior`.
4. Validate file ownership and mode without printing file contents.
5. Start the green candidate off-traffic. Its metadata-only readiness must say
   `ready: true`, identify exactly one current writer, identify the intended
   prior reader, remain within the three-prior bound, and say
   `secretMaterial: "redacted"`.
6. Prove sign-in for retained old-version credentials and prove a newly created
   or rotated test credential records only the new current version. Keep all
   customer and production traffic held during this private proof.

## Zero-downtime promotion

1. Keep the blue predecessor serving while green reaches readiness.
2. Atomically route new requests to green at the existing local reverse-proxy
   boundary; make no DNS or provider change.
3. Drain blue without sending it new requests. Requests begun on blue can only
   write its old current version, which green explicitly reads as prior.
4. Confirm green remains ready and its redacted evidence still names only the
   intended writer/readers. Retain blue and both materials for the rollback
   window.

## Retirement fence

Password rotation and successful recovery rewrite credentials with the current
writer. Registration requests created before promotion can also retain an old
version until activation, expiry, or supersession. Do not remove a prior reader
until the following read-only SQL, run through the approved credential-safe
database console, returns no row for that prior version:

```sql
with required_reader as (
  select split_part(password_phc, '$', 5) as pepper_version,
         'active_credential'::text as source
    from ss.hosted_password_credentials
  union all
  select split_part(password_phc, '$', 5) as pepper_version,
         'actionable_registration'::text as source
    from ss.hosted_registration_requests
   where state in ('pending_delivery', 'delivered', 'delivery_unknown')
     and expires_at > clock_timestamp()
)
select pepper_version, source, count(*)::bigint as reference_count
  from required_reader
 group by pepper_version, source
 order by pepper_version, source;
```

Before accepting those counts, separately require this integrity fence to
return `0`:

```sql
select count(*)::bigint as metadata_drift_count
  from (
    select pepper_version, password_phc
      from ss.hosted_password_credentials
    union all
    select pepper_version, password_phc
      from ss.hosted_registration_requests
     where state in ('pending_delivery', 'delivered', 'delivery_unknown')
       and expires_at > clock_timestamp()
  ) identity_record
 where pepper_version <> split_part(password_phc, '$', 5);
```

The evidence may retain only version, source, and count. It must contain no
email, user, credential verifier, token, digest, environment value, or secret.
For the retiring version, both sources must be absent or exactly zero on two
separate observations at least 24 hours apart, the configured maximum
actionable registration lifetime. If either observation is nonzero or missing,
or either integrity fence is nonzero, retirement remains held.

## Retire without downtime

1. Prepare another green candidate with the same current writer and the proven
   unused prior entry removed. Do not change the current material or version.
2. Start it off-traffic and require metadata-only readiness with no retired
   version in `verifier.priorVersions`.
3. Atomically switch the local proxy and drain the predecessor.
4. Preserve the predecessor configuration and material through the approved
   rollback window. Destruction is a separate owner-controlled credential
   operation and is not authorized here.

## Rollback

- Before retirement, route traffic back to the retained blue predecessor. New
  credentials written by green remain readable because the rollback candidate
  must explicitly configure green's version as a reader before receiving
  traffic.
- After retirement, do not roll back to a candidate that cannot read the current
  writer version. Prepare and privately verify a bounded overlap candidate
  first.
- Any missing version evidence, readiness drift, unknown credential reference,
  or need to reveal material is a hard stop.
