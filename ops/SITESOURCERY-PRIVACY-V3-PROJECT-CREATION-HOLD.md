# Hosted joint legal V3 project-creation hold

This runbook is the backend control for the coordinated Privacy V3 and Website
Terms V3 cutover. It is a write hold for project creation only. Existing
account reads, project reads, static legal reads, and the immutable Privacy V2
and Website Terms V2 continuity paths remain available while the hold is
active.

## Before release

1. The legal lane supplies both reviewed V3 versions, one shared effective
   UTC instant, both full-page digests, byte counts and artifact URIs, and the
   canonical three-document authority digest.
2. The constants handoff in `server/hosted/project-legal-authority.mjs` is
   replaced with those exact values. No value is inferred from a filename,
   page title, current date, or rendered source.
3. Migration 48 is applied and the readiness flags prove both immutable V2
   artifacts, the exact Privacy/product/website V3 documents, the Privacy and
   Website Terms V3 artifacts, receipt constraints, and the joint-v48 marker.
4. The static artifact verifier proves the served current and versioned
   Privacy V3 and Website Terms V3 bytes equal the same receipt digests and
   byte counts before project writes are resumed.

## Hold behavior

When either document constant, the shared effective instant, the authority
digest, or any readiness proof is absent or mismatched, project creation
returns `503 LEGAL_CONFIGURATION_REQUIRED`. The public authority read returns
the same fail-closed result; it never returns synthetic V3 values. Other
GET/static routes remain live. `X-Forwarded-For` is ignored and only the
actual `User-Agent` header may be hashed for the private receipt.

Do not activate Alakazam billing or lifecycle, Care, publication,
customer-domain purchase, or Responder from this checkpoint. The accepted
Alakazam Care/lifecycle policy belongs to a later Privacy V4 release.
