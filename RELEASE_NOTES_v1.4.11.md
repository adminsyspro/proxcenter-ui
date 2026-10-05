# ProxCenter v1.4.11

**Licenses delivered and renewed from your proxcenter.io account, a redesigned License tab, air-gapped installs and upgrades, PVE backup job history, guest disk bandwidth, and a long list of Site Recovery, migration and tenant fixes.**

## Licensing

- **Connect to proxcenter.io** from Settings > License: approve the code from your account, or let your reseller partner approve it, and the license is delivered within seconds. It renews itself through a daily sync, with nothing to copy.
- **A license follows one install.** The License tab shows the install fingerprint, and a license bound to another install raises a critical alert instead of a silent drop to Community. The identity can be reset.
- **Add-ons travel the same way**: HA and API add-ons are delivered and renewed with the edition.
- **Partners appear in the License tab** with their name and logo, and their customers are pointed to them for renewals.
- **An imported license takes over** when the main license is missing, expired, past its lease or bound elsewhere. The tab says which license provides the edition and until when, and the main license takes back as soon as it is valid.
- **Network outages are visible and harmless**: a failed sync is shown with its retry time, and the license keeps working until the end of its 30 day lease.
- **A redesigned License tab**: one summary card, alerts with their actions, the license table, and an Advanced section. "Server without Internet access?" now explains the offline steps before downloading the request file.
- **License actions are reserved to the provider tenant** in a multi-tenant install.

## Installation and upgrades

- **Install and upgrade from an air-gapped bundle**, with checksums and a manifest, for sites without Internet access.
- **A build from a released tag skips the type check**, and building from source is documented.
- **The orchestrator reports its real version** instead of `dev`.

## Site Recovery

- **Per guest states in the drawer**: skipped because a backup holds the guest, re-seed required with its reason and a confirmation, source guest missing with its orphaned DR snapshots cleaned from the Snapshots tab.
- **The plans sharing a guest are shown**, a test failover cleanup is followed while it runs, and plan details get a real window.

## Migration

- **A failed warm delta pass is retried** instead of failing the migration.
- **Snapshots that block a migration within the cluster are explained**, and a disk move or unused disk removal warns about them first.
- **Bulk migration starts each guest once**, and migrated VMs get the Proxmox default CPU type.
- **A finished NFC download is kept** when the node is slow to answer the checks that follow.

## Multi-tenancy and vDC

- **Tenants deploy the templates the provider shared with them**, and the vDC ISO library shows in the wizard again.
- **Custom image sources**: a tenant's uploads stay usable, a provider image stays deployable from an ISO library storage, and an image pointing at another guest's disk is refused.
- **The deploy wizard lists only the selected vDC's storages**, with the quota caption.
- **MAC and VLAN changes need explicit rights**, and the media right alone mounts, swaps and ejects an ISO.
- **A tenant saving its inherited branding keeps the provider's logo**, and the favicon follows the tenant switch.

## Monitoring and alerts

- **Guest disk bandwidth and IO pressure** in the VM list, the storage overview and the Summary charts.
- **Performance metrics over a custom time range**, picked or dragged on the chart.
- **The guest disk latency peak raises its own alert**, and acknowledged alerts leave the bell and the dashboard widgets.
- **The audit log is forwarded to syslog and SIEM collectors.**
- **Node summary gauges show the resources provisioned to its guests.**

## Nodes, backups and inventory

- **The run history of PVE backup jobs**, with the log per guest, and several guests restored from one backup server in a single pass.
- **The Node Update dialog reports the real apt outcome** and never reboots a node after a failed update.
- **PVE stops the guests when a node is shut down or rebooted**, the votes a rolling update rests on are shown, and the SSH host key of a reinstalled node is re-trusted from the interface.
- **Consoles and terminals stay on the fallback node** when the PVE API endpoint fails over.
- **The Flow Diagram searches VMs by IP, name or VMID**, with highlight and filter modes.
- **An active task stops from its row**, each account picks the shape of its inventory tags, and the pools Proxmox declares show even when empty.
- **PVE disk sizes are read in their real unit**, the full volume ID shows on the Hardware tab, and a cluster node's management IP is told apart from its Corosync links.
- **Firewall**: a disabled rule shows as disabled, and a load failure is explained instead of an empty list.
- **PBS backups are no longer named after a live guest** that only shares the VMID, and a ticked column stays visible at any window width.

## Authentication

- **SSO group to role mappings are ordered**, and that order is honoured.
- **LDAPS accepts the CA certificate of an internally signed directory.**
- **The OIDC id_token stays on the session row** instead of the session cookie.
- **Map tiles are configurable**, and the CARTO watermark is gone.

## Dependencies

Patch and minor dependency groups updated, `@mui/x-tree-view` 9, brace-expansion and fast-uri on patched releases, and the PBS storage attach logs sanitized.

## Upgrading

Pull the images. Eight schema migrations ship with this release, applied by the frontend entrypoint at first boot, and the orchestrator updates its own schema when it starts. Nothing has to be edited by hand, on a standalone install as on an HA cluster.

**Your current license keeps working unchanged**, file or pasted key: connecting to proxcenter.io is a choice, made from the License tab. Licenses delivered by the connected mode need ProxCenter 1.4.11 or later; if you receive one, update, then click Connect to proxcenter.io. File licenses issued before 1.4.11 are not offered for pairing. Air-gapped sites keep the file flow.
