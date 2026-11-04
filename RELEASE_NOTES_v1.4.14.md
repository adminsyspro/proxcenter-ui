# ProxCenter v1.4.14

**A Ceph cockpit, bulk power actions, multi-node maintenance.**

## Fixed in priority

- **Requests authenticated with a valid API token no longer hang**: since 1.4.13 they looped on the license check until the proxy timed out, and grew the frontend's memory until it restarted.
- **Scheduled reports run**: no schedule had ever fired, nor the nightly report retention cleanup. They now run from the leader, once per pass, with no restart after an edit.

## New

- **Ceph cockpit**: health rail, host map, OSD table with latency, IOPS and throughput, pools, CRUSH, services and performance, at about a sixth of the former Proxmox calls (history is Enterprise).
- **Power actions on a selection of guests**, across nodes and clusters, from any guest list, the tree or the node menu.
- **Several nodes of a cluster in maintenance as one drain**, so a guest moves once and HA brings it back to the right node.
- **Available updates notification**: package updates pending on the Proxmox VE nodes, sent through the notification channels and shown as an info alert (Enterprise, off by default).
- **Brand name and logo in every notification email**, white label included.
- **Inventory > Network lists the guests behind each VNet, bridge and VLAN**, across every node of the cluster.
- **One bridge and VLAN picker** in every NIC, create and migration dialog, searchable by name, tag or zone.
- **Running disk moves show their progress** in the task panel, with speed and ETA.

## Fixes

- **A deleted guest no longer comes back** after a reload, and creates, clones and migrations refresh one connection only.
- **The first console request no longer fails with a 500** while the connection host is down.
- **The migrate dialog offers a target storage only for local disks**, lists the shared disks that stay put, and refuses a running TPM state move.
- **HA is registered on a clone that lands on another node**, which therefore starts.
- **PBS backups keep their name** from the group notes after retention prunes the annotated snapshot.
- **VMware adapters of every model keep their source MAC**, Flexible, VMXNET3 RDMA and SR-IOV included.
- **A fresh install sends plain HTTP to HTTPS**, and the login page explains when sign-in needs HTTPS.
- **An empty vDC inventory shows the guest list** with Create VM and Deploy from template.
- **DRS node names stay readable** on a crowded per-node chart.
- **The change journal ignores the order of OVS options**, which logged a change at almost every sweep on OVS bonds.
- **Info alerts show as info** in the notification bell.

## Security and isolation

- **IaaS tenants no longer reach the provider's cluster and node routes**: they get a 404 before any Proxmox, SSH or database call.
- **The AI assistant is off for IaaS tenants**, API included.
- **A guest's backups are limited to the tenant's PBS namespaces** on a PBS shared between tenants.
- **Microsegmentation no longer applies an incomplete base group** as if it were complete.
- **Drains and rolling updates check container storage** before any move, so a container on local storage is never moved, and rolling updates now evacuate containers.

## Dependencies

jose 6.2.14, @mui/utils 9.5.0, @peculiar/x509 3.1.0, glob 14 under rimraf, npm minor and patch groups, SonarQube scan action 8.4.0.

## Upgrading

Pull the images. One schema migration ships with this release, applied by the frontend entrypoint at first boot; the orchestrator creates its new Ceph history tables itself.

- **Existing report schedules start sending** at their next occurrence after the upgrade. Passes missed by more than an hour are skipped, so nothing fires in a burst.
- **Per-OSD I/O in the Ceph cockpit needs `ceph-exporter`** on each node, reachable from the orchestrator on port 9926 (set per connection). The page shows the install steps when it cannot read a node.
- **Ceph history is kept 30 days by default**, adjustable in Settings > Alert thresholds (`scheduler.ceph_metrics_retention_days` in `config.yaml` sets the starting value).
- **IaaS tenants that relied on cluster or node screens** now get a 404 on them, by design.
