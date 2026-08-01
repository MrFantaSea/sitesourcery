# Resend account-mail activation

This is the bounded production setup for Site Sourcery account verification
and password recovery. It does not authorize deployment, payment activation,
publication, domain purchasing, or changes to inbound root-domain mail.

## Fixed reviewed facts

- Provider: Resend.
- Sending domain: `sitesourcery.com`.
- From: `Site Sourcery <accounts@sitesourcery.com>`.
- Reply-To: `sitesourcery@proton.me`.
- Adapter:
  `/opt/sitesourcery/current/server/hosted/resend-mail-transport.mjs`.
- Resend open tracking: disabled.
- Resend click tracking: disabled.
- Resend TLS: enforced in the provider configuration.

## External setup — keep mail held

1. Sign in to the owner-controlled Resend account. Do not use a contractor or
   assistant-owned account.
2. Add exactly `sitesourcery.com` as a sending domain. Leave receiving
   disabled.
3. Keep open and click tracking disabled and set TLS to enforced.
4. Copy Resend's exact SPF and DKIM records into the authoritative Spaceship
   DNS zone. The SPF return-path records may include MX and TXT records under
   the `send` subdomain; do not replace or invent an apex MX record.
5. Do not alter the existing NS, website A/AAAA/CNAME records, or any inbound
   mail record. Do not enable Resend receiving.
   DMARC policy is a separate reviewed DNS decision; do not invent or add one
   during this bounded provider setup.
6. Trigger Resend verification and wait for the domain and every SPF/DKIM
   record to report verified. Capture the non-secret record names, types,
   statuses, and verification time in the operator evidence; never capture the
   API key.
7. Create a dedicated Resend API key for this runtime. The current readiness
   check needs permission to retrieve the configured domain as well as send
   email. Store it in the root-owned production environment file. Before that
   environment exists, it may be staged only in the owner's login Keychain;
   remove that temporary item only after the production copy and readiness are
   proven.
8. Record the Resend domain UUID as `SITESOURCERY_RESEND_DOMAIN_ID`. Store no
   recipient, token, action URL, or API key in Git, chat, screenshots, or an
   operator note.

## Private proof — still keep mail held publicly

1. Configure both transport module paths and the two Resend values in the
   root-owned environment file, with mode still `held` in the public runtime.
2. Start an isolated private runtime against a disposable PostgreSQL database
   with both account-mail modes set to `production` only for that proof.
3. Confirm readiness reports provider `resend` for registration and recovery.
4. Send one verification message and one recovery message only to an
   owner-controlled inbox. Confirm From, Reply-To, subjects, links, expiry,
   and delivery.
5. Replay each exact command and prove Resend records one provider message,
   not two. Force one ambiguous provider response and prove the database stops
   automatic replay in reconciliation state.
6. Remove the disposable database and private runtime. Reconfirm no secret or
   recipient entered logs, public API responses, Git, or the release artifact.

Only after this proof is recorded may the production mail modes move from
`held` to `production`. Deployment and publication still require their own
separate approval and release gate.
