# ProxCenter v1.4.3

**Feature release: MSP mode (whole-cluster tenant ownership), multi-license stacking, connection health diagnostics, and guest names in alerts and event emails.**

## MSP mode
- **Whole-cluster tenant ownership.** An MSP tenant can own entire Proxmox clusters (full-cluster view), alongside the existing vDC / IaaS slicing. The provider / NOC sees the whole fleet (dashboard, VMs, alerts, reports) for supervision and license aggregation, while each MSP tenant operates only its owned clusters.
- **Provider provisioning.** Assign or release connections to MSP tenants from Settings, with a "Tenant / vDC" ownership column on the connection lists and an owner selector when creating a connection.
- **Scoped operations.** MSP tenants get fleet-wide scope on their owned clusters: inventory tree, dashboard, alerts, reports, backup jobs, and VM migration among their owned connections (intra-cluster always, cross-cluster between two owned clusters).

## Multi-license
- **License stacking.** Import additional licenses to grow fleet capacity without regenerating the primary license. Fleet-total node quota, per-tenant rollup, "Licensed to" per import, plus edit-mapping and remove, all from the Settings license tab. A single-license install behaves exactly as before (one license, no imports).

## Connections
- **Connection health diagnostics.** A per-connection Diagnostic column and modal run read-only checks: reachability, authentication and permissions, version, cluster health / quorum / Ceph, storage, and SSH for PVE; version, auth and datastores for PBS; basic reachability for external migration sources. Works in Community mode (no orchestrator dependency).
- **Nodes column** collapses to the first node plus a count, with the full list on hover.

## Alerts & notifications
- **Guest names in alerts and event emails.** VM and CT alerts and event notifications now show the guest name next to the vmid ("Name (vmid)") in the alerts table, the navbar dropdown, and the email template.

## Templates
- **Deploy wizard exposes real bridges and an editable VLAN tag** for provider and MSP modes (vDC tenants keep the VNet picker).

## Fixes
- **Orchestrator API authentication.** The orchestrator now reads the API key from `PROXCENTER_API_API_KEY` (the value docker-compose already injects, identical to the frontend's key), so authentication can be enabled and matches the frontend. An unset key keeps authentication disabled as a safe fallback, so installs without a shared key are unaffected.
- **Green Score insight** moves to its own row so longer suggestions stay fully readable.
- **The What's New panel no longer opens automatically** on a new version; open it any time from the profile menu.
