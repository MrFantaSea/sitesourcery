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
- No real verification or recovery message has been sent.
- The isolated disposable-PostgreSQL inbox, replay, and ambiguous-response
  proof in `ops/RESEND-SETUP.md` remains the next mail milestone.
