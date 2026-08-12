# Retired public-truth V2 capsule

Public-truth V2 stopped being an executable GitHub Actions workflow on
2026-08-11. V3 is its designated current successor publication graph. The V2
workflow, verifier, and test remain here as historical evidence from exact K
`b03cccbdc5252db3bd5f90084dbfa27beca33f52`; none of their bytes were edited
during retirement.

The archived workflow deliberately lives outside `.github/workflows`, so
GitHub cannot parse, dispatch, or accidentally re-enable it. Its paths and
commands describe its historical checkout layout and are not current
instructions. Its preserved bytes include the duplicate `pages` permission
keys that actionlint identifies at archived lines 146–147; that historical
parse failure is recorded, not repaired. Do not execute the archived verifier
or test from this capsule.

`manifest.json` binds every original path to its archived path, Git blob ID,
SHA-256, and byte count. `scripts/test/public-truth-v2-retirement.test.mjs`
proves those identities, proves the original active paths are absent, and
proves the npm/V3 graph retains the retirement policy.

| Role | Git blob | SHA-256 | Bytes |
| --- | --- | --- | ---: |
| Workflow | `10eb1a5e912fd9633cee3c9476d934b6be2964f0` | `6acde54e74230507cf6fea0f25e07a0a9c063c764cf1272bd297ba901c678932` | 11,524 |
| Verifier | `62e57317f2321b9d17e4d80893626a9c8f18f4c4` | `2029e568672d9601b1b9a7fd1ccc6448dbfce5c0e1660acf2810713738ae6042` | 33,009 |
| Test | `182c0ebe546b7fea791536ad503583da01839940` | `1865a6eb588c8e7385368d57a84b54a4208df4054d7d7ff3238fb083dd080135` | 8,360 |

Retirement is repository-owned rather than a GitHub-disable-only setting.
External disable state is mutable, invisible to clones and forks, and leaves
the obsolete YAML in GitHub's active workflow discovery directory. Repairing
V2 in place was also rejected: it would mutate the preserved workflow blob
and retain the obsolete V2 deployment authority alongside its designated V3
successor. Any future publication design must be a newly reviewed successor,
never a reactivation or rewrite of these V2 bytes.
