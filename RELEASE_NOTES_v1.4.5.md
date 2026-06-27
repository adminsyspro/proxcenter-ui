# ProxCenter v1.4.5

**Maintenance release: security compliance frameworks, a fix for the v1.4.4 OIDC role demotion, plus a batch of migration, inventory and DRS improvements.**

## Compliance (Enterprise)
- **Security compliance frameworks.** A new Frameworks tab in Compliance assesses a connection against NIST 800-53 r5, NIST 800-171 r2, CMMC Level 2 and ISO/IEC 27001:2022, reusing the existing hardening checks through a check-to-control crosswalk. Each framework shows a score donut and a satisfied / partial / failed breakdown, with a per-node result table, and exports a styled PDF report (cover, per-control table, provenance and source link) rendered by the WeasyPrint sidecar.

## RBAC & access
- **OIDC role preserved on login (v1.4.4 regression fix).** v1.4.4 re-derived every OIDC user's role from IdP groups on each login and demoted anyone with no group match to viewer, which could lock out admins whose role was assigned manually. The re-sync is now authoritative only when a group-to-role mapping is configured and the IdP actually sent a groups array; otherwise the existing assignment is preserved, mirroring the LDAP path. First login still seeds the configured default role.
- **Correct OIDC account handling.** OIDC accounts now show an OIDC auth method instead of being labelled "Local", and setting a local password is blocked on OIDC and LDAP accounts on every surface (user edit dialog, profile, and the API), so an SSO account cannot gain a credentials login path that bypasses SSO and MFA. The profile shows "OIDC / SSO" as the login method with a provider-aware notice.

## Migration
- **SDN VNets in the network selector.** The migration target-network dropdown now lists SDN VNets alongside classic Linux and OVS bridges, so nodes whose guest networks are VNets no longer get an empty list. VNets are labelled to distinguish them from bridges, and non-SDN clusters are unaffected.
- **Source MAC preserved.** Warm and direct-ESXi migrations now carry over the source NIC's MAC address (matching the cold / virt-v2v path), so the migrated guest keeps its network identity instead of booting with a fresh adapter and a stranded IP. The target boots only after the source is powered off, so there is no MAC collision.
- **Warm migration reliability.** A stale /dev/nbdN device is now released before attaching, and the warm delta-apply is chunked to stay under the SSH argument-size limit, so large or busy disks no longer fail late in the transfer.
- **Cleaner vCenter logs.** The misleading "vSAN datastore detected" line is no longer logged on the vCenter NFC path.
- **Running LXC migration fixed.** Migrating a running container now uses restart mode (restart=1) instead of online=1, which Proxmox rejects for containers, so an online CT migration no longer fails outright.

## Inventory
- **Open in Proxmox.** A button next to the cluster or node name opens the native Proxmox web interface in a new tab. Clusters and standalone hosts open the connection origin; a cluster member node deep-links to its own management IP, falling back to the connection origin when the node IP is unknown or the connection sits behind a reverse proxy.
- **Network view on VM-less clusters.** The Inventory Network view now enumerates host bridges and VLANs per node, so a cluster with no VMs is no longer empty. Bridges are listed once at the node level and open a detail panel (type, VLAN, IP/CIDR, ports, vlan-aware, active/autostart, attached VMs); SDN VNet ids resolve to their friendly alias. Provider / full-cluster scope only; vDC tenants keep their pool-filtered, VM-derived data.
- **Per-tenant tree state.** The inventory tree expand/collapse state is scoped per tenant, so switching tenant no longer carries over the previous tenant's expansion.
- **Clearer VM delete dialog.** The VM delete confirmation dialog spells out exactly what will be removed.
- **No clipped "100%".** The percent chart Y-axis is widened so the "100%" label is no longer clipped.

## DRS & maintenance
- **Balance Types is now honored.** The DRS load balancer respects the VM / CT Balance Types selection, which was previously a dead knob: candidates are filtered by guest type for both reactive balancing and homogenization, the setting is persisted and validated (an empty or non vm/ct value is rejected), and a guest-type gate is applied at execution time so a stale recommendation cannot move a guest of an excluded type.
- **Simpler node maintenance.** Entering node maintenance now just triggers Proxmox node-maintenance (HA guests are evacuated and spread by Proxmox), with a note that non-HA guests must be migrated or shut down manually. The forced single-target migration and the client-side storage scan are gone; the SSH-required notice and a disabled confirm button show only when SSH is disabled.
- **DRS settings cleanup.** The settings panel drops the balancing-method and balancing-mode selectors (knobs the engine never read, which also silences a backend warning), guards the Balance Types selection at a minimum of one, puts the three resource-weight sliders on one row, and adds cluster, node and guest icons with status across the exclusions and balance-types controls.

## Connections
- **Per-node SSH test results on failure.** The cluster SSH test now shows the per-node ok / error breakdown on failure too, so one unreachable or misconfigured node no longer hides behind a bare "SSH test failed". The orchestrator resolves each node's own management IP for the test rather than reusing the connection endpoint.

## Reliability
- **No stale task re-alerts.** Old completed tasks are no longer surfaced as new alerts about a week after they ran, when the event poller's dedup window outlived Proxmox task retention.

## Security
- **Patched orchestrator CVEs.** The Go orchestrator's dependencies are bumped (golang.org/x/crypto, x/net, x/sys) to clear the SSH, HTML and IDNA advisories.
