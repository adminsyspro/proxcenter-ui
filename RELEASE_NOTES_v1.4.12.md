# ProxCenter v1.4.12

**Backup restore drills, alert notifications to Slack, Teams and webhooks, host drain, per VM failover in Site Recovery, write access for API tokens, and warm migrations that convert the guest at cutover.**

## Migration

- **Warm migrations convert the guest at cutover**: the VM boots from VirtIO and keeps its static IP, from VMware and XCP-ng sources.
- **A two column migration dialog with a review step**: network per NIC, hardware overrides, a target storage per disk, and disks that can be left behind.
- **Bulk migrations run in parallel from a server side queue**, and warm copies can use a chosen VMkernel network.
- **Every copied disk is verified before a VMware VM is handed over**, and a vTPM source keeps its TPM.
- **Thick zeroing is capped per target cluster**, and leftover nbdkit readers are swept.
- **A storage plugin warning no longer breaks warm migrations**, and a failed warm job cleans up after itself.
- **A failed migration shows the reason Proxmox gives**, and a guest is reported migrated only once its task succeeded.
- **"Cutover now" stays reachable** when the migrate dialog is minimized.
- **A volume image deploys on another cluster** from a copy declared on it.

## Site Recovery, backups and replication

- **Backup restore drills**: test restores of PBS backups in an isolated VM, on demand or on a schedule.
- **Fail over and fail back one VM** of a DR plan.
- **Guests covered by no backup job** are listed and raise an alert.
- **Restore files straight into a running guest**, limited to the tenant's own vDC backups.
- **PBS backups are browsed by machine**, and restore points open in a detail dialog.
- **A full restore keeps the MAC addresses** and overwrites the existing VM, and a restore can leave the backed up tags behind.
- **Replication jobs are editable**, and an interrupted or cancelled sync puts the job back on schedule.
- **Replication snapshots are named in UTC and ordered by creation**, so the end of daylight saving time no longer breaks the next sync.

## DRS, nodes and HA

- **Drain a host from the inventory**: maintenance, Migrate all VMs and reboot through one evacuation plan that refuses what cannot move.
- **DRS explains placement per guest** and why an action is refused.
- **A rolling update waits until the node is really evacuated**, DRS stays out of the cluster meanwhile, and a node in maintenance no longer reads as offline.
- **Each node's SSH address and port are configurable**, and used on every SSH path.
- **An SSH command no longer runs twice** when the orchestrator answer is lost.
- **A guessed node address never replaces the management IP** used for failover.
- **A Proxmox connection is checked with read only probes**, with a fix per failure.
- **The HA control plane converts on air-gapped sites and from a private registry**, and the HTTP proxy reaches the orchestrator container.
- **A cluster can be excluded from the license quota**, with the overflow shown per license.

## Multi-tenancy and vDC

- **vDC usage history**: sampler, retention, charts, CSV export, deleted vDCs included.
- **Tenants create pure L2 networks**, the VNI choice is scoped to the transport, and the L3 edge model is explicit per vDC.
- **Catalogue images and blueprints are granted per tenant or per vDC**, and the grant is enforced at deploy time.
- **A provider deploys a template into a tenant vDC**, and tenant template images are staged on the vDC ISO library.
- **Storage rights are scoped to named storages** for ISO uploads and backup destinations, and every right the role editor offers is enforced.

## Security and access

- **API tokens can write**, with per creator rights, tenant confinement and audit.
- **The login lockout policy is enforced**, and client IPs are resolved through trusted proxies.
- **LDAP sign-in refusals are explained** by a connection test and a read only user lookup.
- **Every role a user cumulates from SSO is shown**, and tenant view saves no longer erase them.
- **The Events view shows which ProxCenter user opened a console.**

## Monitoring and alerts

- **Alert notifications to Slack, Teams, ntfy, Discord and webhooks.**
- **The bell, the summary and the alerts page** count and list the same alerts.
- **The Top consumers widget ranks guests** by CPU, memory, disk or network over a time window, with a metrics retention set from the interface.
- **Network Flows tells sFlow reception from configuration**, and alerts when a configured node stops reporting.
- **Reports tell VMs and containers apart**, and the inventory report lists storages and guest networks.
- **A guest's total disk size is shown and metered**, not only its boot disk.
- **OpenTelemetry metric servers save** with the options PVE expects.

## Firewall, network and inventory

- **Firewall logs are searched and filtered** per security group, rule, node and cluster.
- **The guest firewall state and default policies** show the way Proxmox applies them.
- **An emptied rule field is cleared**, a rule created disabled stays disabled, and rule dialogs are no longer cropped.
- **Proxmox pools are created, deleted and commented** from the Pools view.
- **Guests are found by tag in the inventory tree**, and the Tags column sorts.
- **Ceph OSD grids show each OSD with its own state.**
- **A storage upload chunk is retried after a proxy timeout**, without being written twice.
- **The Network tree reloads once every cluster has arrived**, and a stalled Inventory stream is dropped.

## Dependencies

Next.js, sharp, shell-quote, msw 3, vitest 5, tar-stream 3 and the patch and minor groups updated, zlib patched in both images, `golang.org/x/net` 0.60.

## Upgrading

Pull the images. Fifteen schema migrations ship with this release, all additive, applied by the frontend entrypoint at first boot, and the orchestrator updates its own schema when it starts.

- **The metrics history is now pruned**: the orchestrator keeps 14 days by default and removes older samples. To keep more, raise the retention in Settings > Alert thresholds right after the upgrade.
- **Custom roles and user grants holding `vm.view` also get `storage.content`**, which the guest views need.
- **An HA cluster converted before 1.4.12 keeps its compose file**: to pull from a private registry or go through an HTTP proxy, add `REGISTRY`, `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` to `/opt/proxcenter/.env` and the compose on each node. Nothing changes for a cluster that needs neither.
