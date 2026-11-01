# ProxCenter v1.4.13

**Built-in HTTPS, an AI assistant that proposes actions you approve, an Availability & SLA page with an incident register, a capacity cockpit with a year of forecast, configuration backup and restore, and warm VMware migration on OpenVDDK.**

## New

- **Built-in HTTPS** with self-signed, uploaded or ACME certificates, managed from Settings.
- **AI assistant**: a floating chat with charts and 25 scoped read-only tools, which proposes actions, guided plans and choices you approve (Enterprise).
- **Availability & SLA**: uptime timelines per node and cluster, SLA policies, maintenance windows, budget notifications and an incident register.
- **Capacity cockpit** on the Resources page, with a forecast drawn from up to a year of history.
- **Back up and restore the whole configuration** from the settings page.
- **Every action that goes through ProxCenter is audited**, the orchestrator's own actions included.
- **Task archive** on the Events page, search in the taskbar, and the task history of a down node read from the copy ProxCenter keeps.
- **Settings move to a grouped side navigation**, and What's New shows one summary per release.

## Change journal

- **Readable diffs, an activity timeline, day headers and bursts**, with created and deleted guests.
- **Who made each change**, verified, inferred or unknown.
- **Firewall, access, storage and node network changes and failed logins** are tracked.

## Migration

- **Warm VMware migration runs on OpenVDDK**, installed by "Prepare this node", and survives network blips during the copy.
- **The vCenter is probed from the Proxmox node** before a warm migration, and an unreadable certificate is explained.
- **Every target node's warm runtime is checked** before a bulk warm migration starts.
- **Windows Server 2025 on PVE 9 nodes** through ProxCenter's virt-v2v build, with data disks online at first boot.
- **Conversions virt-v2v cannot do are explained**, and the guest stays on hardware it has drivers for.
- **Hyper-V migrates only the disks attached to the VM**, and Hyper-V and Nutanix keep every network card and MAC address.
- **The migration log follows its newest lines** like a terminal.

## DRS, nodes and HA

- **The drain planner migrates a hand-picked selection** of guests spread over a cluster.
- **The DRS page is easier to read**, its reasons are translated, and evacuation and affinity recommendations are no longer auto-rejected.
- **Node maintenance keeps Ceph OSDs in**, shows every OSD flag, manages Ceph daemons and alerts on a noout left set.
- **HA is offered on deploy and clone**, works on container clones, and Windows templates deploy with their firmware and disk bus.

## Guests, vDC and replication

- **The VM creation wizard is complete**: Multiqueue, bridge MTU, machine version, CPU flags and sliders.
- **vDC tenants create blank VMs** and install them from their own ISO.
- **The inventory export adds guest OS, firmware, machine type, QEMU agent, creation and last boot.**
- **Mounted ISOs are flagged before replicating**, and a replica's CD drive is left empty when its ISO is not on the DR node.
- **PBS requests are bounded by a timeout**, and Backup Explorer downloads `.blob` files.
- **A dashboard import replaces** an existing dashboard of the same name.

## Security and access

- **Local passwords are hashed with argon2id**, and every published image carries a build provenance attestation, with a CycloneDX SBOM for the frontend.
- **Tenant and RBAC scope are checked on the resource** for infrastructure, migration and backup routes.
- **A disabled tenant is cut off**, sign-out ends the session, SDN reads are tenant scoped, and the audit retention is applied.
- **A user can hold several RBAC roles** in the same tenant.
- **An OIDC identity cannot be bound** to a protected or already bound local account, and SSO calls can go through an outbound HTTP proxy.
- **The proxy refuses request bodies over 100 MiB** with a 413.
- **PVE User Tag Access is enforced** for ProxCenter users.
- **Orchestrator hardening**: path segments validated, migration scripts escaped, TLS 1.2 minimum for LDAP and SMTP, sFlow decoding hardened.

## Performance and Proxmox load

- **Protected Proxmox calls are capped per node**, and guest snapshots are no longer re-read every minute.
- **One inventory poll cycle at a time and one fan-out per tenant and vDC**, with a sizing matrix for large estates.
- **IP and snapshot details load for the displayed page only**, and My vDC charts read in one RRD batch, paused on a hidden tab.
- **The firewall log is read from the end of the file**, without stacking scans on a node.

## Dependencies

Go 1.27 on Alpine 3.24, chi 5.4.0, AI SDK v5, @peculiar/x509 2.2.0, dompurify 3.4.17, noVNC 1.7.0 bundle rebuilt, npm and Go groups updated, GitHub actions pinned by SHA.

## Upgrading

Pull the images and the new compose file. Twelve schema migrations ship with this release, applied by the frontend entrypoint at first boot.

- **HTTPS stays off until it is enabled in Settings.** On an existing install, set `HTTPS_BIND` in `.env` to publish the HTTPS port on a fixed host port.
- **Passwords are rehashed at the next sign-in**, after which an older version can no longer verify them. On an HA cluster, upgrade the three nodes back to back.
- **An HA cluster converted before 1.4.13 keeps its compose file**: for HTTPS or an SSO proxy, add `APP_URL`, `TLS_PORT`, `TLS_ENABLED`, `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` to the compose on each node.
- **A node prepared with Broadcom's VDDK** must be prepared once more to get OpenVDDK. `GHCR_TOKEN`, `PROXCENTER_VDDK_PACKAGE` and `PROXCENTER_VDDK_TAG` are no longer read.
- **Audit entries past the retention are deleted** when Automatic cleanup is on in the compliance settings.
- **Host SSH overrides held by a tenant other than the connection's** are reset, and AI provider keys left in older audit entries are redacted.
