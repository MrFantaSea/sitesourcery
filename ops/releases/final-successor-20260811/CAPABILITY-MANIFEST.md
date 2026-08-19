# Mandatory capability manifest

Schema: `sitesourcery.capability-process-matrix/v1`

Frozen by: FIN-006 unified composition

Proved candidate: `bd88d45630212dc6f0a954be246389ea92788834`

Proved candidate tree: `c286be2eb9f6e56da29075a7baaed4100833a434`

Every row is required. `held` describes effect authority only after local
engineering is complete; it does not mean installed, publicly reachable, or
provider-released. The exact candidate process snapshot is separately frozen
in `PROCESS-PROVIDER-MANIFEST.md`.

| # | Key | Engineering state | Startup required | Exact process set | Effect posture |
|---:|---|---|---|---|---|
| 1 | `public_successor` | Candidate | No | `public_static` | Static |
| 2 | `hosted_browser` | Candidate | No | `public_static`, `hosted_api` | Static |
| 3 | `accounts_recovery` | Ready | Yes | `hosted_api`, `postgresql`, `worker` | Held |
| 4 | `organizations_tenancy` | Ready | Yes | `hosted_api`, `postgresql` | Held |
| 5 | `projects_downloads` | Ready | Yes | `hosted_api`, `tenant_runtime`, `postgresql`, `worker` | Held |
| 6 | `publication` | Ready | Yes | `hosted_api`, `tenant_runtime`, `worker` | Held |
| 7 | `assessment_custom` | Ready | Yes | `hosted_api`, `postgresql`, `worker` | Held |
| 8 | `alakazam` | Ready | Yes | `hosted_api`, `postgresql`, `worker` | Held |
| 9 | `domains` | Ready | Yes | `hosted_api`, `postgresql`, `worker` | Held |
| 10 | `care` | Ready | Yes | `hosted_api`, `postgresql`, `worker` | Held |
| 11 | `responder` | Ready | Yes | `hosted_api`, `postgresql`, `worker` | Held |
| 12 | `operator_support` | Ready | Yes | `hosted_api`, `postgresql` | Held |
| 13 | `transactional_mail` | Ready | Yes | `hosted_api`, `postgresql`, `worker` | Held |
| 14 | `provider_reconciliation` | Ready | Yes | `hosted_api`, `postgresql`, `worker` | Held |
| 15 | `backup_restore` | Candidate | No | `hosted_api`, `postgresql`, `tenant_runtime`, `monitoring_deadman` | Held |
| 16 | `monitoring_deadman` | Candidate | No | `monitoring_deadman` | Held |
| 17 | `client_profile_hub` | Ready | Yes | `hosted_api`, `postgresql` | Held |
| 18 | `dell_commercial_engine` | Ready | Yes | `hosted_api`, `postgresql` | Held |
| 19 | `marketing_desk` | Ready | Yes | `hosted_api`, `postgresql` | Held |
| 20 | `messenger_command_phone` | Ready | Yes | `hosted_api`, `postgresql` | Held |

The production root derives these rows from the mounted runtime dependencies,
uses one shared snapshot for `/ready` and `/capabilities`, and rejects startup
when any startup-required row is not ready. Public/artifact closure remains
FIN-007, successor data/restore remains FIN-008, and exact installed process
readback remains FIN-009. Those later phases do not make a completed FIN-006
internal row false, and a held provider does not make a missing dependency true.

FIN-006 proof binds real HTTP, negative role/tenant, PostgreSQL persistence,
worker, adjacent-system, and all-held composed-journey evidence through
`FIN-006-UNIFIED-COMPOSITION-PROVENANCE.md`.
