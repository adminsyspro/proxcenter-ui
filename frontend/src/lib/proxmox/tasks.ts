// src/lib/proxmox/tasks.ts
//
// Shared poller for asynchronous PVE operations. Used by every code path
// that fires off a long-running PVE call (qemu create, qmrestore, qemu
// clone, storage download-url, ...) and needs to wait for the actual
// result before driving the next step.
//
// The endpoint /nodes/{node}/tasks/{upid}/status returns:
//   - status === 'running'   → still in progress, retry after a delay
//   - status === 'stopped'   → terminal; exitstatus tells us OK vs error

import type { ProxmoxClientOptions } from './client'
import { pveFetch } from './client'

export interface WaitForTaskOptions {

  /** Total timeout in ms before we give up. Default 10 min. */
  timeoutMs?: number

  /** Polling interval in ms. Default 3 s. */
  intervalMs?: number
}

/**
 * Poll a PVE task until it finishes. Throws on PVE-side failure or
 * timeout, returns nothing on success.
 *
 * Caller convention: after a long-running POST/PUT/DELETE that returned
 * a UPID string, await waitForTask(conn, node, upid) before assuming the
 * action is complete on the cluster.
 */
export async function waitForTask(
  conn: ProxmoxClientOptions,
  node: string,
  upid: string,
  options: WaitForTaskOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 600_000
  const intervalMs = options.intervalMs ?? 3_000
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const status = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
    )

    if (status?.status === 'stopped') {
      if (status.exitstatus === 'OK') return
      throw new Error(`PVE task failed: ${status.exitstatus || 'unknown error'}`)
    }

    await new Promise((r) => setTimeout(r, intervalMs))
  }

  throw new Error(`PVE task timed out after ${Math.round(timeoutMs / 1000)}s`)
}
