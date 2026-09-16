# ProxCenter v1.4.10

**Site Recovery on ZFS with recovery per guest, the vDC tenant model, 53 Prometheus metric families with Grafana dashboards, disk latency monitoring, and warm migrations without VMware Tools.**

## Site Recovery

- **A ZFS storage engine next to Ceph RBD**, with test failover by clone and a fixed target node.
- **DR replicas are named apart from production**, by prefix or suffix, editable after creation.
- **A test failover suspends only the guests under test**, their siblings keep replicating.
- **A cut off cleanup no longer reads as a finished one**, and keeps its retry button until everything really is cleaned.
- **Emergency DR acts per guest**: replica state on the row, start from a chosen restore point, stop it again, and plan failback moved to the plan header.
- **Starting a replica claims that one guest** instead of pausing the whole job, and a guest another job already replicates is refused.
- **A replication network per connection**, an initial sync streamed as a sparse diff, and failback across differently named Ceph pools.
- **Interval schedule mode**, so a 30 minute RPO no longer replicates every 10 minutes.

## Migration

- **A source without VMware Tools is powered off hard at cutover** instead of waiting thirty minutes on an operator, and IDE and SATA disks keep their bus.
- **A warm migration whose source vSphere the node VDDK cannot read is refused up front**, and a failed block apply shows the real error.
- **Warm migrations no longer wedge NBD devices** on Linux and LVM guests.
- **Parallel NFC disk downloads with a concurrency slider**, and honest thin disk progress.
- **Cross cluster migration prerequisites are cleared from the dialog**: HA, replication and snapshots lifted, then restored or rolled back.
- **Cutover, cancel, force power off and root disk choice sit on the job row** and survive a reload.

## Multi-tenancy and vDC

- **vm.config splits into fine grained rights**: media, NIC link, NIC, hardware and boot, and the guest interface follows them.
- **A compute policy per vDC**, unrestricted or limited to chosen CPU models, and read only ISO libraries with an optional tenant upload area.
- **A VXLAN transport per vDC**: operator peers, a dedicated transport network and an MTU, and a tenant wide VNI for a network stretched across clusters.
- **Provider SDN VNets are accepted as shared uplinks**, with their allowed VLAN pool in the deploy wizard.
- **SSO groups map to a role inside a tenant or a single vDC**, and signing out ends the identity provider session.
- **An SSO login no longer re adds its own role** beside the one an administrator set.

## Monitoring and alerts

- **The Prometheus exposition grows from 7 to 53 metric families**, guests with no backup at all included, and five Grafana dashboards for fleet, nodes, guests, storage and backups.
- **Guest disk latency**: inventory and storage columns, a Disk I/O curve, a per storage alert and a dashboard widget.
- **Every installed package is scanned for CVEs**, and a Ceph HEALTH_ERR names the conditions behind it.
- **Ceph chart times follow the browser timezone**, and cluster OSD flags are set from the page.
- **An exclude pattern for stale snapshot alerts**, and alert mails that carry readable values.

## DRS

- **A History tab with the reason behind each migration**, and what constrains placement is shown.
- **Balancing happens inside each placement domain**, guests are weighed by their host memory footprint, and migrations the target node cannot run are no longer proposed.

## Inventory and interface

- **A Guests per Node widget**: cluster, node and guest tree with live CPU and RAM.
- **The command palette finds guests by IP, MAC and notes**, and nodes by IP.
- **A Proxmox Backup Server datastore attaches to a cluster from the inventory**, with a sub token limited to it.
- **USB and PCI passthrough through datacenter resource mappings**, and nested pools rendered as a collapsible tree.
- **An LXC container features editor**, an Options tab gated by guest type, and rename through the hostname.
- **Fullscreen and a detachable window for the node shell**, and a self updating cloud image catalog.
- **Change tracking exports as CSV**, dashboards export and import as one JSON file, and a report downloads its data as CSV next to its PDF.
- **A Customization tab for the report PDF template**, with a live preview.
- **White label brands a tenant again and only as a super administrator**, with the favicon and the tab title fixed.
- **A subscribed node carrying only enterprise repositories no longer blocks a rolling update.**
- **Infra scope isolation for aggregate reads**, and a user whose assignment keeps the default scope gets the whole inventory back.

## Dependencies

Security advisories closed on next, sharp, svgo and the AI SDK chain, the mysql2 pin inherited from the Prisma CLI overridden, and fast-uri bumped.

## Upgrading

Pull the images. Eight schema migrations ship with this release, applied by the frontend entrypoint at first boot, and the orchestrator updates its own schema when it starts. Nothing has to be edited by hand, on a standalone install as on an HA cluster.

**If you query our Prometheus exposition:** `proxcenter_backup_age_seconds` now carries `node`, `name` and `type` labels. An aggregation over the bare metric needs a `max by (vmid)` or an equivalent.
