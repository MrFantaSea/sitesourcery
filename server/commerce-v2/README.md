# Abracadabra commerce v2

This directory is an isolated, server-only contract for the action-based Spark
offers. It does not replace or reinterpret `server/commerce` v1.

The private catalog contains exactly:

| Offer | Server price | Entitlement |
| --- | --- | --- |
| `spark_download` | owner-accepted one-time USD 5 | non-consuming, non-expiring download and self-host use for one editor project |
| `spark_publish` | provisional USD 15/month | publishing for one editor project while active |
| `spark_publish_help` | provisional USD 30/month | publishing and the defined help boundary for one editor project while active |

Assisted Launch is quote/invoice work and is intentionally absent from the
self-service catalog.

Every offer and checkout preparation remains private and held. The boundary has
no provider adapter, Stripe identifier, secret, network path, or dispatch
authority. A checkout preparation is only a durable, idempotent statement of
the exact server purpose that a later separately reviewed dispatcher would
need.

Quotes bind the catalog and terms versions, exact server price, tenant,
customer, editor project, accepted project version, version content digest,
entitlement kind, and full customer disclosure. Both the disclosure and the
complete quote snapshot have canonical SHA-256 digests.

The customer boundary accepts identifiers and an accepted disclosure digest
only. It recursively rejects money, provider fields, entitlement authority, and
all v1 tenure fields or IDs.

`authorizeProjectEntitlement` consumes no entitlement state. A valid
`spark_download` entitlement can therefore authorize repeated download clicks,
later accepted versions belonging to the same editor project, and downstream
self-hosting without another purchase. Cross-project use is indistinguishable
from a missing entitlement.
