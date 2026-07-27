# ProxCenter v1.4.6

**Feature release: a highly available control plane, license add-ons, an interactive warm cutover, and a large batch of migration and inventory fixes.**

## High availability (add-on license)
- **ProxCenter HA.** Turn a standalone installation into a three-node control plane with replicated PostgreSQL, etcd quorum and a virtual IP that fails over. ProxCenter HA is a separate add-on license, not part of the Enterprise edition.
- **Deployment wizard and cluster dashboard.** A guided conversion runs prerequisite checks (TCP reachability, host listener collisions, VIP interface and prefix) before it touches anything, then reports live progress. Once converted, the HA dashboard shows per-node status, a service grid and an operations panel.
- **Branding stored in the database.** Logos and login backgrounds are stored in PostgreSQL instead of on the local filesystem, so every node of an HA cluster serves identical branding regardless of which one answers.

## Licensing
- **License add-ons.** Option licenses stack on top of your edition license rather than replacing it. They appear in the license table with the capabilities they unlock, do not consume node entitlement, and are available from the customer portal.

## Migration
- **Interactive warm cutover.** Choose the cutover moment yourself, with a live downtime estimate, instead of letting the migration switch over on its own.
- **Block volumes allocated as raw.** Warm migration allocates block volumes as raw instead of qcow2, which removes a large allocation delay on LVM and Fibre Channel targets. A failed allocation no longer leaves an orphan volume behind that poisoned every subsequent retry.
- **No NBD device collision.** Warm migration allocates a free `/dev/nbdN` device instead of assuming one, so a second concurrent migration no longer collides with the first.
- **Long warm copies no longer hang.** The warm copy over SSH keeps the connection alive and applies an inactivity timeout, so a stalled transfer fails cleanly instead of hanging indefinitely.
- **No spurious failure after a cross-cluster move.** A cross-cluster migration no longer fires two destroy tasks against the source VM, which could report a failure after the guest had in fact moved successfully.
- **Sortable source inventory.** The external hypervisor VM table can be sorted by column, which makes picking guests out of a large vCenter inventory practical, and sorting no longer crashes on incomplete inventory data.
- **Readable migration log.** The migration log console keeps its last line visible above the tasks footer.

## Snapshots
- **Delete all snapshots of a VM in one action**, with a guard that blocks a cross-cluster migration while snapshots still exist.

## Inventory and topology
- **RBAC-scoped views.** The inventory and topology trees and the connections list are scoped to RBAC infrastructure grants, so a user only sees the connections they were granted.
- **VMs grouped by SDN VNet**, with VXLAN and zone information.
- **Host VLANs with no attached VM** are shown in the Network view instead of being omitted.
- **Correct node local time.** Node Local Time no longer applies the UTC offset twice.
- **Storage capacity per cluster.** Capacity in the Overview is aggregated per cluster, so shared storage is no longer counted once per node.

## Provisioning
- **Blueprints** gain custom images, cloud-init configuration, hardware sliders and IP and bridge selectors.
- **Cloning suggests the next available VMID** instead of a random one.
- **Cloud-init IP settings** are applied on bridges that have no IPAM configured.
- **VM names starting with a digit** are accepted.

## Alerts and backups
- **Batch acknowledge and delete on alerts.** Select several alerts and act on them in one go.
- **Scheduled backup jobs run on the guest's real node** instead of the first node of the cluster.

## Connections and access
- **Node power management works out of the box.** The generated PVE token setup script includes `Sys.PowerMgmt`, so node reboot and shutdown work without editing permissions by hand.
- **Full rights on Community.** Users created on a Community installation are granted super-admin rights.

## Interface
- **Korean and Spanish interface languages**, and KRW currency support.
- **Consistent alerting UI in every language.** Remaining hardcoded French strings in the alerting interface moved to translation keys.
- **Clipboard fallback.** The SSH-command and task-log copy buttons degrade gracefully when the browser blocks the clipboard API outside a secure context.
- **Panel width is remembered**, and theme status chips are readable in both light and dark themes.

## Security
- **Validated SSH command inputs.** Node, VMID and storage identifiers are validated before being interpolated into SSH commands.
- **No stale entitlement on a failed license check.** The license client no longer keeps the previous entitlement state when a license check fails; it falls back to Community.

## Upgrade notes
- **An expired Enterprise license is now refused.** Feature gating treats an expired license as unlicensed, so Enterprise surfaces such as DRS, reports and compliance fall back to Community behavior until the license is renewed. Renew before upgrading if your license is close to expiry.
