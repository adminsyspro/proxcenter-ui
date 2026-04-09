# Failover Redesign

**Date:** 2026-04-09
**Status:** Approved
**Scope:** Connection failover, node IP discovery, console routing

## Problem

ProxCenter's current failover is fragile:
- Node IPs are only discovered when the user visits the Inventory page
- After a container restart or fresh install, the IP cache and DB are empty, making failover impossible
- The first timeout triggers failover immediately (false positives with slow Proxmox/ZFS)
- The console (noVNC) always connects to the configured baseUrl, not the node hosting the VM

## Goals

- UI stays accessible when a node goes down (no lag, no spinner)
- Dead node shown as offline in the inventory tree
- Console connects to the VM's actual node, not the configured connection host
- Failover works immediately after fresh install or container restart

## Non-Goals

- Automatic failback to the original node
- User notification on failover
- Alerting/notifications for node down events (separate feature)

## Design

### 1. Node IP Discovery

Three entry points ensure IPs are always available:

**A) Connection test/save**
When the user tests or saves a PVE connection in Settings, after a successful API call:
1. Call `/nodes` on the connected host
2. Resolve management IPs (reuse existing `resolveManagementIp` logic)
3. Upsert into `ManagedHost` table
4. Populate in-memory `nodeIpCache`

**B) App startup**
On first poll cycle for each PVE connection:
1. Call `/nodes` via `pveFetch` (which can itself failover using DB IPs from previous runs)
2. Update `ManagedHost` and `nodeIpCache`

**C) Periodic refresh in poller**
The inventory poller runs every 10 seconds. Every 30 cycles (5 minutes):
1. Call `/nodes` for each connection
2. Update `ManagedHost` and `nodeIpCache`
3. Detects nodes added/removed from the cluster

No new tables or services. Reuses existing `ManagedHost` (Prisma) and `nodeIpCache` (in-memory with globalThis).

### 2. Failover in pveFetch

Changes to `src/lib/proxmox/client.ts`:

**Consecutive failure threshold**
- Track consecutive failures per connection in-memory: `Map<connId, number>`
- Only trigger failover after 3 consecutive hard failures
- Reset counter on any successful request

**Timeouts are not hard failures**
- `isNetworkError()` currently returns true for `TimeoutError` — change this
- New `isHardNetworkError()`: only ECONNREFUSED, EHOSTUNREACH, ECONNRESET, ENETUNREACH, ENOTFOUND
- Timeouts log a warning but do not increment the failure counter
- Timeouts do not trigger failover (Proxmox can be slow, especially with ZFS)

**Reduced primary timeout**
- Primary request: 8 seconds (down from 15s)
- Failover candidates: 5 seconds (unchanged)

**Better logging**
- Log when failover triggers and which node is selected
- Log when failover is impossible (no IPs available)
- Log when failure counter increments

The rest of the mechanism stays: candidate scan, anti-thundering-herd lock, failover URL cache.

### 3. Console noVNC

Change in the console session creation route (`/api/v1/.../console`):

**Current behavior:** session stores `baseUrl` from the connection config. The ws-proxy connects to that host.

**New behavior:** session stores the URL of the node that hosts the VM.
1. The console route already receives `node` (the PVE node name hosting the VM)
2. Look up the node's IP from `ManagedHost` (or `nodeIpCache`)
3. Build the session URL using that node's IP instead of `baseUrl`
4. If the node IP is not found, fall back to `baseUrl` (backwards compatible)

No changes to `ws-proxy.js` itself. The fix is upstream in session creation.

If a VM is migrated during an active console session, the WebSocket connection drops (Proxmox terminates VNC during migration). The user reopens the console, which reads the updated node from the inventory (refreshed every 10s by the poller) and connects to the new node. Same behavior as Proxmox native UI.

## Files Impacted

| File | Change |
|------|--------|
| `src/lib/proxmox/client.ts` | Failure counter, timeout handling, reduced timeout, logging |
| `src/lib/cache/nodeIpCache.ts` | Add failure counter storage |
| `src/lib/cache/inventoryPoller.ts` | Periodic `/nodes` refresh every 30 cycles |
| `src/app/api/v1/connections/[id]/route.ts` | Call `/nodes` on connection test/save |
| `src/app/api/v1/.../console/route.ts` | Build session URL from VM's node IP |
| `src/app/api/v1/connections/[id]/nodes/route.ts` | Extract IP discovery into reusable function |
