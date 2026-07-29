# Focused threat model

| Threat | Control in this foundation | Residual risk |
| --- | --- | --- |
| Host-header routing attack | URL authority and Host must normalize identically; IPs and malformed DNS rejected | Caddy configuration must preserve the intended Host |
| Arbitrary TLS issuance | Exact active custom-host object lookup through Caddy `ask`; hold denies all | Compromised control data or loopback process can authorize |
| Path traversal | Manifest-only relative paths; dot segments, backslashes, controls, absolute paths rejected | URL normalization may change spelling, but cannot leave release root |
| Symlink escape | Every path segment checked, final open uses `O_NOFOLLOW`, resolved containment checked | Local privileged attacker can race filesystem checks; local disk/user isolation still required |
| Release tampering | Immutable ID, read-only tree, byte length and SHA-256 on every read | Same Unix user/root can alter bytes, causing availability loss rather than silent serving |
| Partial publish | Complete release installed first; one atomic mapping switch activates it | Multi-machine activation needs a separate distributed design |
| Stale writer | Binding compare-and-set revision and serialized local mutations | Multiple OS processes are unsupported; systemd must enforce singleton |
| Crash during state write | temp write, file fsync, atomic rename, directory fsync; committed current pointer | Hardware/filesystem behavior must be tested on Dell/HQ |
| Corrupt routing state | Checksum validation; readiness false; no automatic guessed rollback | Requires operator recovery from history/backup |
| Unknown customer discovery | Unknown/dark hosts share opaque 404 and no-store | TLS certificate transparency can reveal issued public hostnames |
| Control endpoint exposure | Exact loopback authority and public Caddy path block | Firewall/Caddy validation remains operational proof |
| Cache serving after dark | `max-age=0, must-revalidate`; mapping read per request | External proxies configured later must honor/reinforce policy |
