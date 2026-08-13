# ProxCenter v1.4.7

**Security release: two authentication fixes, revocable sessions, disaster recovery failback, and a large batch of migration and inventory fixes.**

## Security

- **Dotted API paths no longer skip authentication.** The middleware classified any request path containing a dot as a static asset and answered before the session check ran, so an API path carrying a dot reached its route handler unauthenticated. Proxmox node names accept dots and the guest routes carry the node name in their path, so a cluster with an FQDN node name exposed guest notes and task data to unauthenticated callers. Reported privately as GHSA-79j6-v2r5-5pw5.
- **Defense in depth on the guest routes.** Notes, tasks and features now carry their own permission checks, evaluated before the Proxmox connection is resolved, so a refused caller never causes the stored API token to be decrypted.
- **First-run setup is bounded.** The setup endpoint stays reachable while no account exists, which is how a self-hosted install bootstraps, but it now enforces a rate limit, accepts an optional `PROXCENTER_SETUP_TOKEN` shared secret, and decides "no user exists" inside a serializable transaction so two concurrent bootstraps can no longer both create an administrator. Reported privately as GHSA-qxgh-pw46-6pw6.
- **Revocable server-side sessions.** Sessions are tracked server side and can be revoked, from a session management screen for your own sessions and from the admin user view for someone else's. Session cookies carry secure flags, and idle and absolute lifetimes are configurable through `SESSION_IDLE_TIMEOUT` and `SESSION_ABSOLUTE_TIMEOUT`.
- **Read-only API tokens.** `pxc_` tokens grant read-only access to a set of aggregated public endpoints, scoped and quota limited, for dashboards and external monitoring.

## Disaster recovery

- **Failback.** A plan that has failed over can now fail back: a reverse incremental sync brings the source back up to date, then an operator-driven cutover switches back, with per-VM rollback and re-protect. Failed-over plans and their jobs stay locked until failback completes.
- **Source fencing on real failover.** A real failover fences the source VMs before starting their replicas, so the same guest cannot run on both sides.
- **Point-in-time recovery and configurable retention** on replication plans, with per-VM failover steps surfaced on the execution results.
- **The orchestrator survives the loss of its configured node.** It fails over to another node of the cluster instead of dying with the one it was pointed at, and it addresses guest commands to the node that actually owns the guest.
- **A node that stops answering keeps its IP.** A failover no longer erases the recorded address of the node that went silent.

## Migration

- **vSphere snapshots are waited out, not abandoned.** A snapshot task on a large VM is followed to completion instead of failing at a fixed 120 second deadline, which blocked warm migrations of multi-terabyte guests.
- **Pre-migration check for HA affinity rules**, so a guest bound by an affinity rule is caught before the move starts.
- **Warm migrations warn before falling back to CBT** and report live progress during pre-zero and copy instead of showing an indeterminate bar.
- **A fully copied warm target is kept** instead of being freed when cleanup runs.
- **Windows guests boot from SATA** instead of LSI SCSI after migration.
- **The i440fx machine type is sent as `pc`**, which unblocks guests pinned to that chipset.
- **Custom CPU models** are handled in the CPU type selects and in the cross-cluster migration pre-check.
- **Migrated disks can be converted to qcow2** as an option.
- **Jobs orphaned by a server restart fail cleanly** instead of staying stuck as running.
- **The virt-v2v temporary storage requirement is hidden in warm mode**, where it does not apply, and no longer reports a false lack of space.

## Multi-tenant and vDC

- **Several vDCs per tenant**, with a global vDC context to switch between them.
- **Optional VMID ranges for MSP tenants.**
- **Tenant selector on the storage overview**, so a provider can read one tenant's storage without leaving the page.

## Access control

- **Tag and pool scoped users see their guests again.** A user whose only grant was a tag or a pool saw an empty inventory since v1.4.6. The perimeter is now derived from the guests that remain visible after filtering.

## Inventory and interface

- **The PVE node is shown in filtered flat VM lists.**
- **Console windows lead with the VM name** instead of the connection identifier.
- **Numeric fields can be cleared** instead of snapping back to a default while typing.
- **Snapshot rows follow the Proxmox task** instead of claiming success before it finishes.
- **Firewall data is read directly from Proxmox** when no orchestrator is running.
- **Security groups can be attached to guests**, with a corrected membership count.
- **The Proxmox rule log level is exposed** in the firewall dialogs and rules tables.
- **The tasks bar keeps the content reachable** when it expands.
- **Batch actions stay available** when alerts are selected from the header checkbox.
- **Dashboard widget filters stay reachable** when a filter empties the view.
- **A provider-configurable maintenance banner** can be broadcast to every tenant.

## Backups, reports and compliance

- **vzdump archives are listed in a guest's Backups tab.**
- **Reports carry the tenant's white label**, including the compliance PDF export, its logo and its footer.
- **The infrastructure report includes every VM** instead of stopping at a cap.
- **A CIS Controls v8.1 card** joins the compliance Frameworks tab.

## Assistant

- **AI prompts are answered in the language of the interface**, whichever provider serves them.

## Dependencies

Seventeen Dependabot updates consolidated into one batch, otplib migrated from 12 to 13 for TOTP, MUI X Data Grid raised to 9.9, GitHub Actions checkout, setup-node and setup-go raised to v7, and the fast-uri and brace-expansion advisories patched within their major branches.

## Upgrading

No migration step is required beyond the usual image pull. Two optional settings are new and unset by default, which preserves current behaviour: `PROXCENTER_SETUP_TOKEN` guards the first-run setup endpoint, and `SESSION_IDLE_TIMEOUT` and `SESSION_ABSOLUTE_TIMEOUT` override the default session lifetimes of 12 hours idle and 7 days absolute.
