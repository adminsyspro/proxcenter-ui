import type { PCTask, PCTaskStatus } from "@/contexts/ProxCenterTasksContext"
import type { SharedTask } from "./sharedTask"

export interface MergedPCTask extends PCTask {
  shared?: boolean
  readOnly?: boolean
  rawStatus?: string
  startedByName?: string
  jobId?: string
}

function statusFor(raw: string): PCTaskStatus {
  if (raw === "completed") return "done"
  if (raw === "failed" || raw === "cancelled") return "error"
  return "running"
}

function mapServerTask(st: SharedTask): MergedPCTask {
  return {
    id: `migration-${st.id}`,
    type: "generic",
    label: st.label,
    detail: st.currentStep ?? undefined,
    progress: st.progress,
    status: statusFor(st.status),
    error: st.error ?? undefined,
    createdAt: Date.parse(st.createdAt),
    shared: true,
    readOnly: !st.isMine,
    rawStatus: st.status,
    startedByName: st.createdByName,
    jobId: st.id,
  }
}

/**
 * Merge per-session local ProxCenter tasks with server-sourced shared
 * migration tasks. Dedup by id (`migration-<jobId>`):
 *  - a terminal server row always wins (never masked by a stale local row);
 *  - over an active server row, a still-running local row wins to preserve the
 *    initiator's restore/interactivity; an interrupted/errored local row loses.
 */
export function mergeSharedTasks(localTasks: PCTask[], serverTasks: SharedTask[]): MergedPCTask[] {
  const byId = new Map<string, MergedPCTask>()

  for (const st of serverTasks) {
    const row = mapServerTask(st)
    byId.set(row.id, row)
  }

  for (const lt of localTasks) {
    const server = byId.get(lt.id)
    if (!server) {
      byId.set(lt.id, lt)
      continue
    }
    const serverActive = server.status === "running"
    if (serverActive && lt.status === "running") {
      byId.set(lt.id, lt) // local interactive row wins over an active server row
    }
    // otherwise keep the server row (terminal server, or non-running local)
  }

  return [...byId.values()].sort((a, b) => {
    const ar = a.status === "running" ? 0 : 1
    const br = b.status === "running" ? 0 : 1
    if (ar !== br) return ar - br
    return b.createdAt - a.createdAt
  })
}
