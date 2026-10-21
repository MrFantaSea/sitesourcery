# Preserve isolation across native releases — October 21, 2026

Implementation `23de0649b65038757a9c52c3fc2cc8f548b4e0d7`, tree `1d14bbffa04ee09b90cf4d7a567eed3c093a38b9`, base `c29c1418e02cbbf6424d47c8410d19859ca65d49`.

Future native releases now preserve the explicit service isolation contract:
exact users and groups, static configuration and systemd properties, candidate
source binds, API transport paths, immutable stage evidence and current file
custody. Candidate code receives only the reviewed read/execute group ACL.
Gateway holds and fresh startup identity, directory-bound live holds, bounded
rollback, and effect-window rechecks remain part of installation and admission.
Legacy releases retain their existing behavior before isolation is installed.

The observed PostgreSQL identity supports exactly the two approved Unix socket
directories after isolation. Privileged maintenance always connects through its
original owner endpoint; the observed socket list is never a connection address.
Exact database identity and migration gates remain intact.

Full `npm test` passed 2709 cases, with 38 optional PostgreSQL skips and zero
failures, plus 24 hosted routes at six required widths. Full log SHA256
`8bda0c8d071a414571dbe030bba2dd888bba933864c9ca09a702f1cdfdf9e0ca`. All 15 implementation paths match independently reviewed
commits 046f3fb0758448fc8dc96d0a41346a9de550863a and
50dec7ba110480660edc5cd70c21d26ac0eb79a8. Focused Python contracts passed 36 cases;
JavaScript authority contracts passed 13. Independent source review receipts:
`4448b7ca48bcfddb88dd51eccb02fca730ebe22fc855f09f79b06790b8a3c740` and
`a24cb90b908ce2d1a97674053269c64be8c29ed92904e2cd50ad85146d91aecf`.

An actual Linux ACL fixture passed 15 positive and negative checks, including
separate numeric identities, idempotent application, forbidden writes, unsafe
metadata and escaping links. It was removed. Its unchanged isolation helper is
SHA256 `a721fbed24bf005f4edc7b500579932a3b1a4bc01d2d972de9edff5937de09a0`;
actual receipt SHA256 `dca579bcb06e09842bc70e05be0ec1527d188790614702898e680bc7905703eb`.

Application, schema and package bytes are unchanged from the protected base.
The already-passed 29 actual PostgreSQL cases and their fixture cleanup remain
applicable; they were not rerun. Receipt SHA256
`7747a65b33355fd7757a61cfc087b4e8f8d4bd3b2bfd9702ba094aaa8a72a22f`.
The earlier 15 runtime filesystem checks are likewise retained, not recounted
as new tests. No production migration or provider message was performed.

This source is prepared and qualified; it is not native isolation acceptance.
Production identities, permissions, namespaces, firewall, SCRAM/HBA, runtime
startup, backup coverage and independent installed verification remain separate.
The systemd/network rehearsal is a different native packet and is not claimed
passed by this source proof. Existing application-wide service-role authority
and trusted kernel/operator remain explicit limits. No absolute security claim.
