# ProxCenter v1.4.4

**Maintenance release: stability and security hardening, shared migration tasks, plus MSP per-tenant dashboards.**

## MSP & dashboards
- **Header tenant switcher.** Switch the active tenant from the navbar; dashboards are scoped to the selected tenant, so the provider can review each tenant's view without leaving the dashboard.

## Migration
- **Shared migration tasks.** In-flight migrations now appear in the footer for every user, so the whole team sees what is running, with a link to the warm-migration setup docs.
- **Correct stream exit code.** A failed block-device transfer is now reported as a failure instead of being masked as success.
- **Bounded thick-target zero-fill.** Warm migration to a thick target bounds the zero-fill so it can no longer exit on a false ENOSPC on the destination volume.

## Backups
- **Real gateway errors.** The Backups tab now surfaces the underlying gateway error instead of failing with "Unexpected token '<'" when a reverse proxy returns an HTML error page.

## RBAC & access
- **OIDC role re-sync on login.** OIDC users re-sync their role from IdP group membership on every login, so group changes take effect immediately.
- **Resource-scoped performance graphs.** RRD performance graphs are scoped to the individual resource rather than the whole connection, closing an RBAC scope leak.

## Reliability
- **Stable performance chart axes.** RRD charts show dates on the axes for multi-day timeframes, not just times.
- **Stable inventory NETWORK section.** The NETWORK section stays in place when a connection briefly blips instead of collapsing.
- **Real errors surfaced.** Guest and node API routes no longer swallow underlying errors, so failures are reported instead of showing empty data.
- **Faster console previews.** VM console screenshots are served as JPEG instead of raw PPM, for lighter and faster previews.
- **Writable cache for the runtime user.** The container creates a writable .next/cache for the non-root runtime user, fixing a startup EACCES behind some deployments.
- **Safer DR config writes.** Replication writes the DR config with cp -f on pmxcfs, avoiding a transient failure window during the write.

## Security
- **Reduced image surface.** The unused npm binary is removed from the runtime image, clearing the bundled undici advisories.
- **Patched CVEs.** Dependency CVEs are patched (including OpenSSL on the orchestrator image), a feature-route error log is sanitized, and front-end dependencies are refreshed (postcss, tailwindcss, @novnc/novnc, next-intl, nanoid, ws).
