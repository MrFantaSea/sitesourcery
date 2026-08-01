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
- It is temporarily stored in the owner's Mac login Keychain as service
  `sitesourcery-resend-production`, account `sitesourcery`; the clipboard was
  cleared immediately afterward.
- Before production deployment, it must move through a private channel into
  `/etc/sitesourcery/hosted.env` on the selected host, owned by root with mode
  `0600`. The temporary Keychain item can be removed only after the production
  copy and readiness are proven.

## Still held

- Registration mail mode remains `held` in the public runtime.
- Recovery mail mode remains `held` in the public runtime.
- The complete customer-click proof in `ops/RESEND-SETUP.md` remains a launch
  prerequisite.

## Private attempt — provider passed, customer path failed

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

The next proof must run through the deployed hosted app and same-origin API.
No further real account mail should be treated as end-to-end evidence until
the owner completes both actions in an ordinary browser.
