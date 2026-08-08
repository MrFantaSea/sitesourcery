# Hosted Privacy V3 project-creation hold

This runbook is the backend control for the Privacy V3 cutover. It is a
write hold for project creation only. Existing account reads, project reads,
static legal reads, and the V2 continuity path remain available while the
hold is active.

## Before release

1. The legal lane supplies the reviewed V3 version, effective UTC, full-page
   digest, byte count, artifact URI, and the canonical authority digest.
2. The constants handoff in `server/hosted/project-legal-authority.mjs` is
   replaced with those exact values. No value is inferred from a filename,
   page title, current date, or rendered source.
3. Migration 48 is applied and the readiness flags prove the V2 artifact,
   V3 document, V3 artifact, receipt constraints, and v48 marker.
4. The static artifact verifier proves the served V3 bytes equal the same
   digest and byte count before project writes are resumed.

## Hold behavior

When any V3 constant or readiness proof is absent or mismatched, project
creation returns `503 LEGAL_CONFIGURATION_REQUIRED`. The public authority
read returns the same fail-closed result; it never returns synthetic V3
values. Other GET/static routes remain live. `X-Forwarded-For` is ignored and
only the actual `User-Agent` header may be hashed for the private receipt.

Do not start Alakazam migrations 49 through 56 from this checkpoint.
