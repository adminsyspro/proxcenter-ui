# Failover Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PVE connection failover reliable by ensuring node IPs are always available, adding a failure threshold, and routing the console to the correct node.

**Architecture:** Three changes: (1) populate node IPs at connection creation, on first poll, and every 5 minutes; (2) add a consecutive failure counter so timeouts don't trigger false failovers; (3) build console session URLs from the VM's actual node IP instead of the connection baseUrl.

**Tech Stack:** Next.js App Router, Prisma (ManagedHost), undici, node:http (ws-proxy)

---

### Task 1: Extract node IP discovery into a reusable function

The nodes route (`/connections/[id]/nodes/route.ts`) already has IP discovery logic (fetch `/nodes`, resolve IPs, upsert ManagedHost, populate cache). Extract the reusable part into a standalone function so it can be called from the connection creation route and the poller.

**Files:**
- Create: `src/lib/proxmox/discoverNodeIps.ts`
- Modify: `src/app/api/v1/connections/[id]/nodes/route.ts`

- [ ] **Step 1: Create discoverNodeIps.ts**

```typescript
// src/lib/proxmox/discoverNodeIps.ts
import { pveFetch, type ProxmoxClientOptions } from "./client"
import { resolveManagementIp } from "./resolveManagementIp"
import { extractPortFromUrl } from "./urlUtils"
import { setNodeIps } from "../cache/nodeIpCache"

/**
 * Discover cluster node IPs via /nodes API and persist them for failover.
 * Lightweight version: only fetches /nodes and /nodes/{node}/network per node.
 * Does NOT fetch /nodes/{node}/status (saves one call per node vs the full nodes route).
 *
 * Returns the discovered IPs array (empty on failure).
 */
export async function discoverNodeIps(
  connOpts: ProxmoxClientOptions,
  connectionId: string
): Promise<string[]> {
  try {
    const nodes = await pveFetch<any[]>(connOpts, "/nodes")
    if (!nodes || !Array.isArray(nodes)) return []

    // Resolve management IPs in parallel
    const entries = await Promise.all(
      nodes.map(async (node: any) => {
        const nodeName = node.node || node.name
        if (!nodeName) return null
        try {
          const networks = await pveFetch<any[]>(
            connOpts,
            `/nodes/${encodeURIComponent(nodeName)}/network`
          ).catch(() => null)
          const ip = resolveManagementIp(networks) || null
          return { node: nodeName, ip }
        } catch {
          return { node: nodeName, ip: null }
        }
      })
    )

    const validEntries = entries.filter(
      (e): e is { node: string; ip: string } => e !== null && typeof e.ip === "string"
    )

    if (validEntries.length === 0) return []

    // Populate in-memory cache
    const ips = validEntries.map(e => e.ip)
    try {
      const port = extractPortFromUrl(connOpts.baseUrl)
      const protocol = new URL(connOpts.baseUrl).protocol.replaceAll(":", "")
      setNodeIps(connectionId, ips, port, protocol)
    } catch {}

    // Persist to DB
    try {
      const { prisma } = await import("../db/prisma")
      const liveNodeNames: string[] = []
      await Promise.all(
        entries.filter(e => e !== null).map((e) => {
          liveNodeNames.push(e!.node)
          return prisma.managedHost.upsert({
            where: { connectionId_node: { connectionId, node: e!.node } },
            update: { ip: e!.ip || null },
            create: { connectionId, node: e!.node, ip: e!.ip || null },
          })
        })
      )
      // Cleanup stale entries
      if (liveNodeNames.length > 0) {
        await prisma.managedHost.deleteMany({
          where: { connectionId, node: { notIn: liveNodeNames } },
        })
      }
    } catch {}

    console.log(`[failover] Discovered ${ips.length} node IPs for connection ${connectionId}: ${ips.join(", ")}`)
    return ips
  } catch (e: any) {
    console.error(`[failover] Node IP discovery failed for ${connectionId}:`, e?.message)
    return []
  }
}
```

- [ ] **Step 2: Refactor nodes route to use discoverNodeIps for cache/DB population**

In `src/app/api/v1/connections/[id]/nodes/route.ts`, after the existing `enrichedNodes` logic (which fetches more data than discoverNodeIps), replace lines 105-144 (the cache population + DB persist block) with a call that reuses the same data but delegates to the shared persistence logic. Keep the existing enrichment (status, bridges, hastate) since the route needs that for the response.

Replace the block at lines 105-144:

```typescript
  // Populate failover cache and DB (reuse enriched IPs already resolved above)
  const nodeIps = enrichedNodes
    .map((n: any) => n.ip)
    .filter((ip: any): ip is string => typeof ip === "string" && ip.length > 0)

  if (nodeIps.length > 0) {
    try {
      const port = extractPortFromUrl(conn.baseUrl)
      const protocol = new URL(conn.baseUrl).protocol.replaceAll(":", "")
      setNodeIps(id, nodeIps, port, protocol)
    } catch {}
  }

  // Persist node IPs in DB for failover after restart
  const liveNodeNames: string[] = []
  try {
    await Promise.all(
      enrichedNodes.map((n: any) => {
        const nodeName = n.node || n.name
        if (!nodeName) return Promise.resolve()
        liveNodeNames.push(nodeName)
        return prisma.managedHost.upsert({
          where: { connectionId_node: { connectionId: id, node: nodeName } },
          update: { ip: n.ip || null },
          create: { connectionId: id, node: nodeName, ip: n.ip || null },
        })
      })
    )

    // Cleanup stale ManagedHost entries for nodes removed from the cluster
    if (liveNodeNames.length > 0) {
      await prisma.managedHost.deleteMany({
        where: { connectionId: id, node: { notIn: liveNodeNames } },
      })
    }
  } catch {}
```

This block stays as-is (it already works and uses enriched data that `discoverNodeIps` doesn't have). The key point is that `discoverNodeIps` is for the NEW callers (connection creation, poller). The nodes route keeps its own richer logic.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/proxmox/discoverNodeIps.ts
git commit -m "refactor: extract discoverNodeIps for reusable failover IP discovery"
```

---

### Task 2: Discover node IPs at connection creation

The connection POST route (`/connections/route.ts`) already fetches `/nodes` for Ceph detection (line 176). Add IP discovery right after.

**Files:**
- Modify: `src/app/api/v1/connections/route.ts`

- [ ] **Step 1: Add discoverNodeIps call after Ceph detection**

At the top of the file, add the import:

```typescript
import { discoverNodeIps } from "@/lib/proxmox/discoverNodeIps"
```

After the Ceph detection block (after line 198, before the PBS validation), add:

```typescript
      // Discover and persist node IPs for failover
      // Must run after connection is saved (needs connection ID), so we defer it
      // using the nodes variable already fetched for Ceph detection
    }

    // Save the connection first (we need the ID for ManagedHost)
```

Actually, the problem is that `discoverNodeIps` needs the connection ID, but the connection isn't saved yet at this point. The save happens later (around line 220+). We need to call `discoverNodeIps` AFTER the connection is created.

Find the line where the connection is saved to DB (the `prisma.connection.create` call). After it succeeds, add:

```typescript
    // Discover node IPs for failover (non-blocking, after connection is saved)
    if (type === 'pve') {
      discoverNodeIps(
        { baseUrl, apiToken, insecureDev: insecureTLS, id: connection.id },
        connection.id
      ).catch(() => {})
    }
```

- [ ] **Step 2: Also add to PATCH route for connection updates**

In `src/app/api/v1/connections/[id]/route.ts`, the PATCH handler already calls `pveFetch` for Ceph re-detection when baseUrl/apiToken changes (lines 182-209). Add IP re-discovery after.

Add the import at the top:

```typescript
import { discoverNodeIps } from "@/lib/proxmox/discoverNodeIps"
```

After the Ceph re-detection block (after line 209), before the `prisma.connection.update` call, add:

```typescript
        // Re-discover node IPs for failover
        discoverNodeIps(
          { baseUrl, apiToken, insecureDev: insecureTLS, id },
          id
        ).catch(() => {})
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/api/v1/connections/route.ts frontend/src/app/api/v1/connections/[id]/route.ts
git commit -m "feat(failover): discover node IPs at connection creation and update"
```

---

### Task 3: Periodic IP refresh in the inventory poller

The inventory poller (`inventoryPoller.ts`) polls every 10 seconds. Add a counter that triggers IP discovery every 30 cycles (5 minutes).

**Files:**
- Modify: `src/lib/cache/inventoryPoller.ts`

- [ ] **Step 1: Add IP refresh logic to pollAll()**

Add the import at the top:

```typescript
import { discoverNodeIps } from "@/lib/proxmox/discoverNodeIps"
```

Add a module-level counter and constant:

```typescript
const IP_REFRESH_INTERVAL = 30 // every 30 poll cycles = 5 minutes
let ipRefreshCounter = 0
```

In the `pollAll()` function, after the existing poll loop (after line 226, where results are processed), add:

```typescript
    // Periodic node IP refresh for failover (every 5 minutes)
    ipRefreshCounter++
    if (ipRefreshCounter >= IP_REFRESH_INTERVAL) {
      ipRefreshCounter = 0
      // Run IP discovery for all PVE connections in parallel (non-blocking)
      Promise.allSettled(
        connections.map(async (conn) => {
          const connConfig = await getConnectionById(conn.id)
          if (connConfig.baseUrl && connConfig.apiToken) {
            await discoverNodeIps(connConfig, conn.id)
          }
        })
      ).catch(() => {})
    }
```

This runs the first IP refresh 5 minutes after the poller starts. For immediate discovery on startup, the first cycle should also trigger it:

Change the counter initialization to trigger on first cycle:

```typescript
let ipRefreshCounter = IP_REFRESH_INTERVAL - 1 // trigger on first cycle
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/cache/inventoryPoller.ts
git commit -m "feat(failover): refresh node IPs every 5 minutes in inventory poller"
```

---

### Task 4: Failure counter and timeout handling in pveFetch

**Files:**
- Modify: `src/lib/proxmox/client.ts`
- Modify: `src/lib/cache/nodeIpCache.ts`

- [ ] **Step 1: Add failure counter to nodeIpCache.ts**

Add to `src/lib/cache/nodeIpCache.ts`:

```typescript
const FAILURE_KEY = "__proxcenter_failure_counter__" as const
const FAILURE_THRESHOLD = 3

function getFailureStore(): Map<string, number> {
  if (!(globalThis as any)[FAILURE_KEY]) {
    ;(globalThis as any)[FAILURE_KEY] = new Map<string, number>()
  }
  return (globalThis as any)[FAILURE_KEY]
}

/** Increment consecutive failure count. Returns true when threshold is reached. */
export function incrementFailures(connId: string): boolean {
  const store = getFailureStore()
  const count = (store.get(connId) || 0) + 1
  store.set(connId, count)
  return count >= FAILURE_THRESHOLD
}

/** Reset failure count (call on any successful request). */
export function resetFailures(connId: string): void {
  const store = getFailureStore()
  store.delete(connId)
}

/** Get current failure count. */
export function getFailureCount(connId: string): number {
  return getFailureStore().get(connId) || 0
}
```

- [ ] **Step 2: Update client.ts - split isNetworkError into hard vs timeout**

In `src/lib/proxmox/client.ts`, replace the `isNetworkError` function:

```typescript
/** Hard network failures that indicate the host is truly unreachable */
function isHardNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const codes = ["ECONNREFUSED", "EHOSTUNREACH", "ECONNRESET", "ENETUNREACH", "ENOTFOUND"]
  const msg = err.message || ""
  const cause = (err as any).cause
  const causeCode = cause?.code || cause?.message || ""
  return codes.some(c => msg.includes(c) || causeCode.includes(c))
}

/** Timeout errors - node may just be slow, not dead */
function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.name === "TimeoutError") return true
  const msg = err.message || ""
  const cause = (err as any).cause
  const causeCode = cause?.code || cause?.message || ""
  return ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].some(c => msg.includes(c) || causeCode.includes(c))
}

/** Any network-level error (hard + timeout). Used for retry/failover signal detection. */
function isNetworkError(err: unknown): boolean {
  return isHardNetworkError(err) || isTimeoutError(err)
}
```

- [ ] **Step 3: Update pveFetch - add failure counter, reduce timeout, improve logging**

Add imports at the top of `client.ts`:

```typescript
import { getNodeIps, setNodeIps, getFailoverLock, setFailoverLock, incrementFailures, resetFailures, getFailureCount } from "../cache/nodeIpCache"
```

In `doRequest`, change the default timeout from 15_000 to 8_000:

```typescript
  async function doRequest(baseUrl: string, timeoutMs = 8_000, ignoreCallerSignal = false): Promise<T> {
```

In the primary request success path (line 167-168, `return result`), add a reset:

```typescript
    try {
      const result = await doRequest(opts.baseUrl)
      if (opts.id) resetFailures(opts.id)
      return result
    } catch (err) {
```

In the primary request failure path, replace the failover trigger logic. Instead of immediately failing over on any network error, use the counter:

```typescript
    } catch (err) {
      primaryErr = err
      if (opts.behindProxy) throw err
      if (!opts.id) throw err

      // Timeouts: log warning but don't count as hard failure
      if (isTimeoutError(err)) {
        console.warn(`[failover] Timeout on connection ${opts.id} for ${path} (not counted as failure)`)
        throw err
      }

      // Hard network error: increment counter
      if (isHardNetworkError(err)) {
        const shouldFailover = incrementFailures(opts.id)
        if (!shouldFailover) {
          console.warn(`[failover] Connection ${opts.id} failure ${getFailureCount(opts.id)}/${3} for ${path}`)
          throw err
        }
        console.log(`[failover] Connection ${opts.id} reached failure threshold, initiating failover...`)
      } else {
        // Non-network error (HTTP 500, parse error, etc.) - don't failover
        throw err
      }
    }
```

Also update the cached failover success path (line 148-150) to reset failures:

```typescript
  if (cachedFailoverUrl) {
    try {
      const result = await doRequest(cachedFailoverUrl)
      if (opts.id) resetFailures(opts.id)
      return result
```

And the final failover success (line 243-244):

```typescript
    const newUrl = await failoverPromise
    if (newUrl) {
      resetFailures(connId)
      return doRequest(newUrl, 8_000, true)
    }
```

Add a log when failover is impossible due to missing IPs (line 218):

```typescript
    if (!cached || cached.ips.length === 0) {
      console.error(`[failover] No node IPs available for connection ${connId}. Visit Inventory or re-save the connection to discover nodes.`)
      throw err
    }
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/cache/nodeIpCache.ts frontend/src/lib/proxmox/client.ts
git commit -m "feat(failover): add failure threshold, separate timeouts from hard errors, reduce timeout to 8s"
```

---

### Task 5: Route console to the VM's actual node

**Files:**
- Modify: `src/app/api/v1/connections/[id]/guests/[type]/[node]/[vmid]/console/route.ts`
- Modify: `src/app/api/internal/console/consume/route.ts`

- [ ] **Step 1: Look up the node's IP and store it in the session**

In the console route POST handler, after `const conn = await getConnectionById(id)` (line 24), add logic to resolve the node's IP:

```typescript
  // Resolve the actual node IP for the WebSocket connection (failover-safe)
  let nodeBaseUrl = conn.baseUrl
  try {
    const { prisma } = await import("@/lib/db/prisma")
    const host = await prisma.managedHost.findFirst({
      where: { connectionId: id, node, ip: { not: null } },
      select: { ip: true },
    })
    if (host?.ip) {
      const { replaceHostInUrl } = await import("@/lib/proxmox/urlUtils")
      nodeBaseUrl = replaceHostInUrl(conn.baseUrl, host.ip)
    }
  } catch {}
```

Then update the session to store `nodeBaseUrl` instead of `conn`:

```typescript
  sessions.set(sessionId, {
    baseUrl: nodeBaseUrl,
    apiToken: conn.apiToken,
    node,
    type,
    vmid,
    port: data.port,
    ticket: data.ticket,
    expiresAt,
  })
```

Update the novncUrl to still use `conn.baseUrl` (it's the user-facing URL):

```typescript
  const baseUrl = new URL(conn.baseUrl)
```

- [ ] **Step 2: Update the consume route to use the session's baseUrl directly**

In `src/app/api/internal/console/consume/route.ts`, the response already returns `s.conn?.baseUrl`. Update it to use the new session shape:

```typescript
  return NextResponse.json({
    baseUrl: s.baseUrl,
    apiToken: s.apiToken,
    port: s.port,
    ticket: s.ticket,
    node: s.node,
    type: s.type,
    vmid: s.vmid,
  })
```

- [ ] **Step 3: Update consumeConsoleSession return type**

In the console route, update the `consumeConsoleSession` function — it stays the same (just returns the session object), but now the session contains `baseUrl` and `apiToken` as direct fields instead of a nested `conn` object.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/api/v1/connections/[id]/guests/[type]/[node]/[vmid]/console/route.ts" frontend/src/app/api/internal/console/consume/route.ts
git commit -m "fix(console): route noVNC to the VM's actual node IP instead of connection baseUrl"
```

---

### Task 6: Integration test — verify failover end-to-end

Manual verification steps since this involves Proxmox cluster interaction.

- [ ] **Step 1: Verify IP discovery at connection creation**

1. Delete an existing PVE connection in Settings
2. Re-add it with valid credentials
3. Check Docker logs for: `[failover] Discovered N node IPs for connection ...`
4. Verify ManagedHost table has entries: check Settings > Connections > node list

- [ ] **Step 2: Verify periodic IP refresh**

1. Watch Docker logs for 5+ minutes
2. Look for: `[failover] Discovered N node IPs for connection ...` repeating every ~5 minutes

- [ ] **Step 3: Verify failover behavior**

1. Stop one Proxmox node (the one configured in the connection)
2. First few requests should fail with warnings in logs: `[failover] Connection ... failure 1/3`
3. After 3 failures: `[failover] Connection ... reached failure threshold, initiating failover...`
4. Subsequent requests should succeed via the failover node
5. UI should remain responsive, dead node shown as offline in tree

- [ ] **Step 4: Verify console routing**

1. With the configured node stopped, open a VM console on a VM running on the other (healthy) node
2. Console should connect successfully (ws-proxy connects to the VM's actual node, not the dead baseUrl)

- [ ] **Step 5: Verify container restart resilience**

1. With one node down, restart the ProxCenter container
2. On startup, the poller should discover IPs from DB and failover should work immediately
3. No need to visit the Inventory page first

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(failover): complete failover redesign - IP discovery, failure threshold, console routing"
```
