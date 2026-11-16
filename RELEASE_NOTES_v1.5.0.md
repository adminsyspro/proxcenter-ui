# ProxCenter v1.5.0

**Managed micro-segmentation.**

## New

- **Managed micro-segmentation** (Enterprise): zones of guests, allowed flows, an observation mode that lists what would be blocked, then enforcement on the Proxmox firewall, with a plan to review before anything is written.
- **Outbound control and per-VM exceptions** in micro-segmentation, a zone map by Proxmox node and a posture dashboard.
- **Firewalling in draft, then publish**, and a wizard that turns the cluster firewall on.
- **An EVPN zone shared between clusters**, with self-service tenant networks and per-vDC quotas.
- **Each tenant signs in through its own OIDC identity provider.**
- **A provider role catalogue published to tenants**, with service desk assignments.
- **Move a VM to another vDC of its tenant**, with a target storage policy per disk.
- **GPU page**: load, history and alerts per GPU, and GPU contingents for vDCs.
- **API tokens manage tenants, vDCs, quotas, EVPN zones, users and role assignments**, and can be rotated.
- **Warm migrations that wait for a manual cutover** can be paced, tested on the target and cancelled with their copy removed.
- **A read rate cap for warm migrations**, per batch, per migration and per source host, with a time window, changed while the copy runs.
- **MAC addresses, disk options and network mapping** are chosen when migrating to Proxmox.
- **Bulk migrations run more than 5 at once**, bounded per target node and per source ESXi host.
- **Mount and eject ISO images** from the VM console toolbar.
- **Pool members, the remaining guest options and cluster storages** are managed from ProxCenter.
- **The inventory tree sorts guests by name** as well as by VMID.

## Fixes

- **XenServer Windows guests boot on Proxmox** after a migration.
- **VMs whose name holds a `+` warm migrate**, and an unreadable source disk is reported as such.
- **A PVE call whose host name lookup failed for a moment is retried**, and a finished migration stays completed.
- **The frontend starts on CPUs without x86-64-v2.**
- **The warm-prep apt source stays readable by Proxmox VE**, and unreadable repository files are explained.
- **PVE storages are matched to a PBS** by host or certificate fingerprint.
- **A finished backup is notified once**, and events are told apart by node and connection.
- **DRS recommendations are kept** when their re-check cannot read the cluster.
- **A guest agent that does not answer is left alone** instead of being asked again.

## Security and isolation

- **SSH host keys are confirmed by an operator** instead of trusted on first use, ESXi migrations included.
- **Node commands can run through a dedicated SSH account with a restricted sudoers file**, generated and checked from Settings > SSH Commands.
- **Rolling update SSH credentials never reach the browser**, storage or the SSH logs.
- **HA clusters get a hardened layout**: etcd in mutual TLS, authenticated Patroni, PostgreSQL over TLS, no privileged container.
- **Accounts that sign in through OIDC or LDAP lose their local password**, with an audited emergency access for super admins.
- **An OIDC identity links an existing account only with a verified e-mail.**
- **Tenants stay within their perimeter** for role assignments, console previews, alerts, incidents, warm-node setup, compliance scans, firewall and CVE data.
- **Request values placed in orchestrator and Proxmox API paths are validated**, and a referenced volume must belong to the guest.

## Dependencies

next 16.4.5, jose 6.2.15, undici 8.12.4, ws 8.22.1, otplib 13.6, vitest 5.1, stylelint 18, minimatch pinned to a patched release, GitHub Actions updates.

## Upgrading

Pull the images. Nineteen schema migrations ship with this release, applied by the frontend entrypoint at first boot.

- **Micro-segmentation needs the address Proxmox sees ProxCenter coming from.** New installs get it from the installer (`PROXCENTER_HOST_IPS`). On an existing install, enter it in Micro-segmentation > Settings > Advanced, or run the installer again.
- **New SSH host keys must be confirmed** from the connection dialog. Keys already pinned stay valid.
- **Existing HA clusters keep working** on the previous layout; the HA tab offers the security upgrade as a rolling run with one planned switchover.
- **A local password on an OIDC or LDAP account is now refused.** A super admin can grant emergency access from the user dialog.
