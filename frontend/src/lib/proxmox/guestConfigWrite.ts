// src/lib/proxmox/guestConfigWrite.ts
//
// Writing a guest config is the one PVE call where the HTTP verb decides how
// long we block. PVE registers two handlers on the same path:
//
//   PUT  /nodes/{node}/qemu/{vmid}/config = update_vm, synchronous. Its own
//        description reads "You should consider using the POST method instead
//        for any actions involving hotplug or storage allocation."
//   POST /nodes/{node}/qemu/{vmid}/config = update_vm_async, which forks a
//        `qmconfig` worker and answers with its UPID.
//
// Memory hotplug is exactly the case PVE warns about. Removing RAM unplugs one
// DIMM at a time and PVE sleeps 3s per module before checking it went away
// (PVE::QemuServer::Memory), with DIMMs of 512 MiB: dropping a running VM from
// 8G to 4G costs 8 modules, so 24s at best against pveFetch's 8s default
// budget. The synchronous PUT therefore aborted on our side while PVE went on
// to apply the change, surfacing as an error popup on a change that worked
// (issue #743). Adding RAM has no such wait, which is why only reductions
// failed.
//
// So: POST for qemu, then follow the task. LXC keeps the synchronous call, it
// has no async handler (PVE::API2::LXC::Config registers PUT only) and applies
// its memory changes through cgroups.

import { pveFetch, PVE_DEFAULT_TIMEOUT_MS, type ProxmoxClientOptions } from "./client"

/**
 * How long a config write may hold the HTTP request while the qmconfig task
 * runs. The reverse proxy we ship drops an upstream that stays silent for 60s
 * (`proxy_read_timeout 60s` in nginx/proxcenter-locations.conf), so we must
 * answer inside that or the browser gets a 504 instead of our JSON. Past this
 * budget we hand the UPID back and let the caller keep following the task.
 */
export const CONFIG_TASK_WAIT_MS = 45_000

const TASK_POLL_INTERVAL_MS = 1_000

/**
 * Seconds PVE may spend waiting for its own worker before answering. Its
 * asynchronous handler takes `background_delay` (1 to 30) and returns null
 * instead of a UPID when the task finished inside it, so a fast write (a tag,
 * an option) still costs a single round trip and still reports its error
 * synchronously. Only a write that really is slow comes back as a task to
 * follow.
 */
const BACKGROUND_DELAY_S = 3

/**
 * PVE holds the HTTP answer for the whole `background_delay`, so the value has
 * to stay inside the budget pveFetch gives this request. A deployment that
 * lowered PVE_TIMEOUT_MS under it would otherwise time out on every config
 * write, which is the very bug this module exists to remove. Zero means "do not
 * ask for it", and PVE hands the UPID back right away.
 */
export function backgroundDelaySeconds(budgetMs: number): number {
  const insideBudgetS = Math.floor((budgetMs - 1_000) / 1_000)

  return Math.max(0, Math.min(BACKGROUND_DELAY_S, insideBudgetS))
}

export type GuestConfigWriteResult =
  /** PVE is done: either there was no task, or it finished successfully. */
  | { state: "done"; upid: string | null }
  /** The task outlived our budget. It is still running on `node`. */
  | { state: "running"; upid: string; node: string }

/**
 * Recognise a task id and the node running it.
 * Shape: `UPID:<node>:<pid>:<pstart>:<starttime>:<type>:<id>:<user>:`
 */
export function parseUpid(value: unknown): { upid: string; node: string } | null {
  if (typeof value !== "string") return null

  const match = /^UPID:([^\s:]+):/.exec(value)

  if (!match) return null

  return { upid: value, node: match[1] }
}

/**
 * Push a config patch to PVE and wait for it to be applied.
 *
 * Throws when PVE rejects the write, or when the qmconfig task ends on an
 * error, so a caller with side effects to undo can treat both the same way.
 */
export async function writeGuestConfig(opts: {
  conn: ProxmoxClientOptions
  type: string
  node: string
  vmid: string
  /** Already URL-encoded form body. */
  body: string
  waitMs?: number
}): Promise<GuestConfigWriteResult> {
  const { conn, type, node, vmid, body } = opts
  const isQemu = type === "qemu"
  const delayS = backgroundDelaySeconds(PVE_DEFAULT_TIMEOUT_MS)

  const answer = await pveFetch<unknown>(
    conn,
    `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/config`,
    {
      method: isQemu ? "POST" : "PUT",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      // background_delay only exists on the asynchronous handler, and its
      // schema refuses anything it does not declare.
      body: isQemu && delayS > 0 ? `${body}&background_delay=${delayS}` : body,
    },
  )

  const task = parseUpid(answer)

  // Synchronous handler, or nothing to apply: PVE is already done.
  if (!task) return { state: "done", upid: null }

  const deadline = Date.now() + (opts.waitMs ?? CONFIG_TASK_WAIT_MS)

  for (;;) {
    let status: any

    try {
      status = await pveFetch<any>(
        conn,
        `/nodes/${encodeURIComponent(task.node)}/tasks/${encodeURIComponent(task.upid)}/status`,
      )
    } catch {
      // A blip on the status endpoint says nothing about the write itself, so
      // it must never be reported as a failed save. Retry, then fall back to
      // "still running" once the budget is spent.
      status = null
    }

    if (status?.status === "stopped") {
      if (status.exitstatus === "OK") return { state: "done", upid: task.upid }

      throw new Error(`PVE task failed: ${status.exitstatus || "unknown error"}`)
    }

    const left = deadline - Date.now()

    if (left <= 0) return { state: "running", upid: task.upid, node: task.node }

    await new Promise(resolve => setTimeout(resolve, Math.min(TASK_POLL_INTERVAL_MS, left)))
  }
}
