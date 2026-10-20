# Public availability observer

The `Public availability` GitHub workflow observes the installed website from
a standard GitHub-hosted runner outside the production host's home network.
It checks the canonical homepage, exact versioned privacy artifact, trusted TLS
with at least 21 days remaining, the exact live API release, and fresh database
readiness. The API being alive alone does not pass the check.

The workflow requests a run at minutes 7, 22, 37 and 52 UTC each hour, and once
when the observer or target changes on protected main. Its three-minute job
limit and ten-second request bounds prevent a hung probe from remaining green.
There is no retry that can hide a failed sample. An operator can also run:

```
node ops/public-availability.mjs
gh workflow run public-availability.yml --repo MrFantaSea/sitesourcery --ref main
gh run list --repo MrFantaSea/sitesourcery --workflow public-availability.yml --limit 5
```

The entrypoint fixes all requests to public Site Sourcery HTTPS endpoints. It
uses no provider, account or customer credentials, SSH, package installation,
Actions cache or uploaded artifacts. Its public output contains fixed failure
codes and public release digests, never response bodies or raw errors. The
workflow has read-only repository permission and refuses private repositories,
forks and non-main refs. No application service is restarted by this workflow.

On failure, inspect the run summary and the existing HQ operations monitor.
`PUBLIC_READINESS_INVALID` with a passing live API can indicate a database or
dependency problem. `CONTENT_ARTIFACT_MISMATCH` or `TUNNEL_READINESS_INVALID`
can also indicate a release-target mismatch. Investigate before changing the
expected target; never learn a new expected release automatically from the
site that is being checked. Existing production alert state/mail is separate
and unchanged. This workflow does not send a test or application email.

GitHub's own Actions failure notifications follow the owner's account
notification settings and the scheduled workflow actor. Their delivery to any
particular mailbox has not been proved by installing this observer. The run
history is the direct evidence. Missing/stale runs mean unknown coverage;
they never establish health. A separate dead-man service is still needed to
detect failure of GitHub's scheduler itself.

[GitHub documents](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
that schedules may be delayed or dropped and public-repository schedules are
disabled after 60 days without repository activity. This observer is not a
guaranteed 15-minute detection SLA. Check its latest run during ordinary
operations and before onboarding. Do not create artificial commits to keep it
alive. Standard hosted runner use in this public repository is
[free](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
No cache, artifact, larger runner or private-repository usage is introduced.

For a future deployment, update `ops/public-availability-target.json` from the
accepted release identity and immutable privacy artifact through protected
source review. Coordinate that target change with the actual cutover; a
temporary mismatch is an honest failed check, never permission to suppress
monitoring or alter production. Source-only changes do not change the deployed
target. The existing sealed native independent-monitor/dead-man entrypoints
and their separate activation controls remain intact.
