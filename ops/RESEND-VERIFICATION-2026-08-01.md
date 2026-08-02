# Resend domain verification — 2026-08-01

This is non-secret operator evidence for the bounded Site Sourcery account-mail
setup. It does not authorize public mail, deployment, payment, publication,
domain purchasing, or inbound-mail changes.

## Verified checkpoint

- Observed at: `2026-08-01T21:02:28Z`.
- Provider domain ID:
  `b7de4950-b5dc-43d2-8a29-847685dd41d6`.
- Domain: `sitesourcery.com`.
- Provider status: `verified`.
- Sending: `enabled`.
- Receiving: `disabled`.
- Open tracking: disabled.
- Click tracking: disabled.
- Public `send` MX SPF record: verified.
- Public `send` TXT SPF record: verified.
- Public `resend._domainkey` TXT DKIM record: verified.
- Existing root website A records and authoritative nameservers remained
  unchanged. No root MX or DMARC record was added.

The reviewed `resend-mail-transport.mjs` readiness call returned exactly:

```json
{"ready":true,"verified":true,"provider":"resend"}
```

The first readiness attempt correctly rejected an incomplete UUID copied into
a scratch note before making a provider request. A read-only authenticated
domain listing supplied the exact UUID above; the corrected readiness call
then passed.

## Credential handling

- Zack explicitly approved a dedicated Full-access key because runtime
  readiness retrieves the configured domain as well as sending account mail.
- The key value was never printed or pasted into a chat, repository file,
  screenshot, or command output.
- It now exists in Zen's private staging environment and Dell's private
  production environment, both mode `0600`. It moved through a two-line private
  transfer file without command output; both temporary copies were removed
  immediately after Dell readiness passed. Its value has not entered Git, this
  evidence, a screenshot, or command output.
- Inspection found no corresponding Mac login Keychain item. The earlier note
  claiming one existed was inaccurate and is superseded by this checkpoint.
- Dell is now the separate production secret store; the staging environment is
  not used by the Dell runtime.

## Still held

- Registration and recovery use the reviewed production Resend adapter in the
  isolated HTTPS staging runtime and the loopback-only Dell production
  rehearsal.
- Production `sitesourcery.com` still serves GitHub Pages and has no same-origin
  hosted API, so public production registration and recovery remain held by the
  uncut edge.
- Dell startup independently reverified the exact Resend authority without a
  send. Both production action bases are already pinned to the exact production
  app, and capabilities report registration and recovery email available.
  Production cutover must still repeat the public route and delivered-action
  proof before account mail is called publicly complete.

## First private attempt — provider passed, customer path failed

At `2026-08-01T21:38:55Z`, the exact public action URL returned GitHub Pages
HTTP `404`. Before that final public-route check existed, one registration and
one recovery message were sent to the owner-controlled proof inbox. Resend
recorded both as delivered, and the isolated disposable PostgreSQL proof
confirmed:

- one registration provider message and no send on exact replay;
- one recovery provider message and no send on exact replay;
- durable registration activation and recovery-delivery evidence;
- a simulated ambiguous recovery response moved to `delivery_unknown`; and
- a restarted service refused to replay that ambiguous effect.

The owner then opened both real email actions. Both links reached the public
404 before any account UI or API action. This invalidates the customer-facing
mail proof even though provider and database checks passed. The account
activated by the harness existed only inside the disposable proof database; no
production account was created.

## Isolated HTTPS staging proof — complete

By `2026-08-01T23:27:00Z`, exact commit
`d7c33c7e4ec7623f63249e0dc5b3d2951e781212` was serving the hosted app and
same-origin API at `https://simbiotechzen.tail85d878.ts.net`. Registration and
activation had completed on the immediately preceding immutable staging
release; after the upgrade, a reviewed real browser completed recovery and the
persisted customer path using the same owner-controlled Proton plus-alias:

- Resend reported the registration message delivered, the exact staging action
  opened, and the canonical account activated.
- Resend reported a new recovery message delivered; its exact staging action
  reset the password, and ordinary sign-in succeeded.
- The resulting session cookie was `Secure`, `HttpOnly`, `SameSite=Strict`, and
  scoped to `/api/v1`; no session or token appeared in browser storage.
- The same account created one project, saved an edited draft, accepted two
  versions, reviewed the exact `$5.00 USD` Download quote, signed out and back
  in, and reopened the persisted project.
- Payment, domain purchasing, and publication remained held. The browser made
  no request to those effect paths and reported zero errors.
- Canonical PostgreSQL recorded one user, one organization, one project, two
  accepted versions, three exact reviewed legal acceptances, one held Download
  quote, and one active session.

The private action-link helper matched the exact recipient, subject, request
time, HTTPS origin/path/hash, and terminal provider delivery event. Neither
action token nor password was printed or retained in this evidence. This
completes the isolated staging proof; it does not claim that production has
been cut over.
