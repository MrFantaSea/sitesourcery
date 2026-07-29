# Production acceptance checklist

All boxes remain unchecked. Code-level tests do not authorize publication.

## Owner and commercial

- [ ] Owner explicitly approves removing `PUBLICATION_HOLD`.
- [ ] Owner explicitly creates `/etc/sitesourcery/PUBLICATION_APPROVED` only
      after this checklist is evidenced.
- [ ] Canonical Rent/Own/Owned+Managed terms and prices are approved.
- [ ] Domain, hosting, retention, grace, support, and transfer promises match
      customer-facing copy.
- [ ] Legal/privacy review covers customer content and domain-contact custody.

## Machine and process

- [ ] Dedicated `sitesourcery` Unix user/group created with no interactive login.
- [ ] Exact Node 24.18.0 production binary provenance and checksum recorded.
- [ ] `/opt/sitesourcery/node-24.18.0/bin/node --version` returns exactly
      `v24.18.0`; EOL Node 20 is not used by the service.
- [ ] Any future `node:sqlite` control-store adapter is reviewed separately as
      release-candidate API and does not replace the immutable filesystem
      release store without durability and restore evidence.
- [ ] Exact Caddy version installed from an approved source and recorded.
- [ ] Held Caddyfile passes `caddy validate` and `caddy adapt` on the target.
- [ ] Held systemd unit passes `systemd-analyze verify` on Dell and HQ.
- [ ] Node remains loopback-only under the installed service.
- [ ] systemd hardening score reviewed and exceptions documented.
- [ ] Reboot test proves automatic recovery with the committed mapping.
- [ ] Kill-during-install and kill-during-activation recovery tests pass on the
      real filesystem.
- [ ] Single-writer enforcement and operator locking are proven.

## Internet edge

- [ ] ISP confirms inbound TCP 80 and 443 are allowed.
- [ ] Public IP or dynamic-DNS strategy is documented.
- [ ] CGNAT is ruled out or replaced with an approved routable connection.
- [ ] Router forwards only 80/443 to the Caddy machine.
- [ ] Host firewall permits the intended traffic and denies the Node/control port.
- [ ] IPv4 and, if published, IPv6 paths are independently tested.
- [ ] DNS A/AAAA/CNAME records resolve to the intended edge from multiple
      independent resolvers.
- [ ] Existing DNSSEC is preserved or deliberately and safely changed.
- [ ] Port scans from a clean external network expose only approved services.

## TLS

- [ ] Caddy `ask` endpoint is reachable only from loopback.
- [ ] Unknown, dark, pending, duplicate-query, and malformed domains deny issuance.
- [ ] ACME staging issuance succeeds for a disposable approved domain.
- [ ] Production issuance succeeds only after staging proof.
- [ ] Renewal is rehearsed and monitored.
- [ ] Caddy certificate/key storage permissions and backups are verified.
- [ ] Clock synchronization and expiry alerts are verified.
- [ ] CA rate-limit and incident procedure is documented.

## Releases and recovery

- [ ] Artifact ingestion is connected to the authenticated Site Sourcery control
      plane with owner/project/digest verification.
- [ ] Restore on a clean machine reproduces control and every active release.
- [ ] Backup is encrypted and stored on a separate machine/location.
- [ ] Retention and pruning preserve every rollback/contract requirement.
- [ ] Disk-full, corrupt-file, missing-release, and read-only-filesystem alerts work.
- [ ] Rollback is rehearsed without editing release bytes.
- [ ] Dell failure and HQ takeover are rehearsed without split brain.

## Customer journey

- [ ] New domain, existing domain, apex, `www`, email-preserving DNS, and
      transfer-out journeys pass from a clean device.
- [ ] Unknown Host and direct-IP requests reveal no customer site.
- [ ] Customer cancellation/dark-state reaches the edge within the promised time.
- [ ] Accessibility, mobile, browser, payment, receipt, support, export, and
      deletion flows pass end to end.

## Observability and incident response

- [ ] External uptime/TLS probes exist outside the home/office network.
- [ ] Structured logs avoid credentials, private content, and transfer codes.
- [ ] Alerts reach a tested human channel.
- [ ] Runbooks cover power outage, ISP outage, disk failure, certificate failure,
      compromise, abuse report, and registrar issue.
- [ ] Recovery time and recovery point objectives have measured evidence.
