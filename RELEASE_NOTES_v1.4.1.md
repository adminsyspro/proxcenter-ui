# ProxCenter v1.4.1

**Patch release: DRS automatic-mode hardening, vSphere migration fixes,
rolling-update reliability, security.**

## DRS, automatic mode hardening

The automatic-mode DRS is significantly safer in this release. Several
latent issues surfaced under multi-cluster workloads with scheduled
rebalancing and are now closed.

- **Per-cluster migration cap** replaces the global cap as the user-facing
  throttle. Operators reason per cluster, not globally, so the legacy
  global setting is removed from the UI. Each cluster gets its own slot
  budget, preventing one busy cluster from monopolizing every scheduled
  tick (backend #5, frontend #333).
- **Per-target inflow cap** (opt-in). Caps how many migrations may target
  the same node within one Rebalance cycle, preventing ping-pong when
  several recommendations converge on the same "least-loaded" node and
  overshoot it.
- **Post-migration snowball fix.** `triggerPostMigrationEvaluation` no
  longer auto-runs `Rebalance()` after every load-balance or rule-violation
  migration completes. The scheduled cron is now the only periodic
  trigger. Maintenance evacuations still self-loop so node drains progress
  batch by batch (backend #4).
- **Vague 1 hardening bundle (backend #3, 10 commits):**
  - 64-bit UUID generation prevents recommendation / migration ID collisions.
  - Post-migration singleflight guards against concurrent re-entry into `Evaluate`.
  - Exclusive scheduler registration so cron overlaps cannot fire two cycles in parallel.
  - Freshness gate (StaleTTL) rejects recommendations that aged out before execution.
  - Storage gate scoped strictly to maintenance evacuation + QEMU, never to automatic rule-violation migrations on local-disk VMs.
  - Affinity enforcement preserved across PVE flap (zero LastSeenAt fail-closed).
  - Target mutation in mergeRecommendations resets confirmation counter.
  - `mergeRecommendations` partitions by recommendation origin (maintenance / rule / load-balance) so flags can't bleed across classes.
  - `EvacuateNode` supersedes prior pending evacuations for the same (cluster, source-node).
- **DRS settings UI cleanup.** Advanced section reorganized into Migration
  limits, Migration behavior, and Resource weights subsections with icons.
  Slider helper text moved to tooltip with `?` icon. Dead-knob toggles
  removed ("Migrate larger first", "Prevent overprovisioning" with
  misleading scope). EWMA formula descriptive block removed.
- **Rebalance interval supports 15m and 30m** in addition to hourly options.

## Migration

- **Migrate-to-Proxmox button greyed out on single-disk Proxmox nodes
  fixed** (#331). When `/` is the only large filesystem on the target
  (no separate `/var/lib/vz`, LVM-thin storage not visible to `df`), the
  preflight returned an empty `tempStorages` list, hiding the Temporary
  Storage selector and silently disabling the Migrate button. `/tmp` is
  now synthesized as a fallback when the root filesystem has at least
  1 GiB free, and a defensive Alert surfaces the truly degenerate case.
- **Long-running PVE config PUT timeouts on slow storage fixed**
  (#332, #334). ZFS-over-iSCSI auto-attach was failing with an 8s
  timeout while the underlying PUT took 20+ seconds. The failover
  masquerade then reported a fake "all cluster nodes unreachable"
  error. All migration-time `/qemu/{vmid}/config` PUTs now use a 120s
  timeout.
- **curl stderr surfaced + orphan LVM freed on stream failure** (#316).

## Rolling update

- **Respect `reboot_timeout` end-to-end** with sustained-online polling
  + verify retry (backend #2). `waitForNodeOnline` used to return on the
  first online sighting. After a reboot pmxcfs can briefly report online
  while corosync re-joins, then flip back to unknown. Now requires 3
  consecutive online sightings (10s sustained), and `verifyNodeHealth`
  polls for up to 60s instead of one-shot.
- **Scope `reboot_timeout` deadline to the reboot path only** so a short
  value doesn't shorten the standalone verify window for non-reboot
  updates.
- **Run apt / ha-manager / ceph / reboot as root via `sudo -n`** when
  the PVE connection uses a non-root SSH user (backend #1).
- **Surface node version and API token permission errors** in the
  rolling-update UI (#318).

## Deployment & install

- **Backfill `ORCHESTRATOR_API_KEY` on upgrade** and refuse placeholder
  at startup (#330). Pre-v1.4.0 installs without the key, and
  `.env.example` placeholder leakage, are detected and fixed by the
  installer. The frontend container refuses to boot with the placeholder.
- **Auto-generate `INTERNAL_API_TOKEN` outside Docker** for source-built
  installs.
- **Install URL** uses `proxcenter.io/install/*` instead of the `get.`
  subdomain.

## AI

- **Test connection for Ollama fixed** (#314, #315). The provider check
  was broken since the auth refactor.

## Security

- **SSRF guard on AI test and models endpoints** (#335). The `ai/test`
  and `ai/models` routes accept user-supplied base URLs for Ollama and
  OpenAI-compatible providers. The validator now blocks cloud metadata
  endpoints (AWS 169.254.169.254, Alibaba 100.100.100.200, OCI
  192.0.0.192, AWS IPv6 IMDS), strips IPv6 brackets before comparison,
  and performs a DNS lookup so DNS aliases (such as `*.nip.io` style
  hostnames) that resolve to blocked addresses are rejected. Loopback
  and RFC1918 remain reachable for legitimate local Ollama setups.
  Closes the 2 critical CodeQL alerts (`js/request-forgery`) on these
  routes.
- **Bump `ws` to 8.20.1** (CVE-2026-45736) (#335).
- **Bump bundled `npm` to 11.15.0** in the runner image (covers
  `brace-expansion` < 5.0.6 / CVE-2026-45149) (#335).
- **Patch bundled npm in runner image for CVE-2026-42338** (`ip-address`
  < 10.1.1) (#311).
- **Tighten enterprise.proxmox.com URL spoofing check** in the license
  validator (#306).
- Backend: bump `go-ntlmssp` to v0.1.1, Alpine base 3.19 to 3.22,
  sanitise filename components against path injection in the reports
  generator.
- Frontend: add shell-arg validators on routes that build SSH commands,
  allow testing SSH against unsaved form values.

## Quality & test coverage

- New PR-only SonarCloud Quality Gate workflow with proper LCOV path
  rewriting and baseline analysis on main.
- New Vitest route-handler harness, with tests for the connections POST
  route, SSH test endpoint, orchestrator client, and SSH helpers.
- Multiple Sonar bug, vulnerability, and smell cleanups.

## Dependencies

- Node 22-alpine to 26-alpine on the frontend image.
- Various dependabot bumps (eslint-config-next, stylelint,
  softprops/action-gh-release).

## Upgrade notes

- No schema changes since v1.4.0. PostgreSQL connection string unchanged.
- The DRS Settings UI presents `max_concurrent_migrations_per_cluster`
  instead of `max_concurrent_migrations`. Existing configs are
  auto-migrated at runtime (per-cluster falls back to 2 when persisted
  value is 0). The legacy `max_concurrent_migrations` field is still
  parsed from existing YAML / DB rows but no longer enforced.
- `rebalance_interval` now accepts 15m and 30m in addition to the
  hourly options.
- AI provider URLs are now subject to an SSRF guard. URLs targeting
  cloud metadata endpoints (link-local 169.254.x, Alibaba, OCI, AWS
  IPv6 IMDS) are refused with an explicit error message. Local Ollama
  setups using `localhost`, `127.0.0.1`, or RFC1918 addresses are
  unaffected.
