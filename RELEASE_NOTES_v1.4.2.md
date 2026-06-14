# ProxCenter v1.4.2

**Feature release: warm migration for VMware (no data loss), in-browser SPICE consoles, a Ceph CRUSH topology view, role-level RBAC scopes, SSO-only and local 2FA policies, plus a security hardening sprint.**

## Migration
- **Warm migration for VMware sources (CBT).** VMware VMs migrate with changed-block tracking and a final delta sync, so there is no data loss on large or busy disks. Covers ESXi-direct and vCenter (including vSAN), single and bulk, with a go/no-go preflight and SOAP-session keepalive (#395).
- **Local migration from the cluster Guests tab** (node-to-node), instead of forcing cross-cluster only (#388).
- **Partial-VM cleanup no longer leaks the target VMID** after a failed conversion (#403).

## Consoles
- **In-browser SPICE console for QEMU VMs**, alongside noVNC (#390).
- **Serial / headless VMs show a badge** instead of looping on a failing screenshot (#375).

## Ceph
- **CRUSH topology view** in the cluster Ceph tab: read-only CRUSH tree with details and pools (#407).
- **Full cluster config with working OSD flag toggles** (#405).

## Security & access
- **Security hardening sprint**: critical findings closed plus follow-ups (#369), TOFU host-key verification on the ssh2 path (#372), per-connection ws-proxy TLS and Dependabot overrides (#371), js-cookie bumped to clear a high-severity advisory (#346), Node 26 pipeline hardening for XCP-ng / Hyper-V / Nutanix (#345).
- **Role-level default RBAC scope**, inherited by every assignment of that role (#386).
- **SSO-only login policy** for OIDC (hide the local form, force the SSO redirect) (#362), plus an issuer fix for manual endpoint overrides (#361).
- **Local TOTP two-factor** with an admin enforcement policy (#351).
- **VM User role gains the read access** the Inventory needs to load (#387).
- **Standalone hosts behind NAT**: node management connects to the public host, not the private interface (#385).

## Backups & reports
- **Reports and notifications overhaul**: connection scoping, backup report polish, per-category severity, and an event-email rework (English copy, task-log details, one mail per event) (#384).
- **Empty guest Backups tab now explains why** (no connected PBS vs no snapshots) (#399).
- **"Run now" works again** (a missing route returned an HTML 404) (#398).
- **Real local backup time and Proxmox-style columns** (#382), and legacy maxfiles is translated to prune-backups (#342).

## Inventory & guests
- **Clone a VM from a snapshot restore point**, choosing a snapshot as the clone source (#412).
- **Guest VLANs resolved from host bond sub-interfaces** so tagged guests group correctly (#391).
- **Resume paused VMs, allow dots in tags** (#409), and the **guest icon dims when off** for color-blind legibility (#411).
- **Dashboard widgets honor the appearance settings**: font-size, corner-rounding, shared gauge (#377).
- **Tree sections stay open** when clicking the PROXMOX VE / NETWORK headers (#367).

## Alerts
- **Pull-based threshold evaluation with silence sync** (#365); silences are respected in the home dashboard widget (#368).

## Dependencies
- Routine bumps (@mui/lab, tsx, @tailwindcss/postcss, trivy-action, sonarqube-scan-action) and an SSO group-name trim fix for LDAP / OIDC mapping (#343).
