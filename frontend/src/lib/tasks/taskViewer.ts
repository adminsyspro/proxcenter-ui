// src/lib/tasks/taskViewer.ts
//
// Opens the task viewer of the taskbar (progress + live log) from anywhere in
// the app. A dialog that starts a Proxmox task used to close and leave nothing
// on screen, the user then had to go and find the task in the taskbar (#1392).
// The taskbar is mounted once by the dashboard layout and owns the viewer, so
// callers only announce the task they just started.

import { parseUpid } from '@/lib/proxmox/upid'

export const OPEN_TASK_VIEWER_EVENT = 'proxcenter:open-task-viewer'

export interface TaskViewerRequest {
  upid: string
  connectionId: string
  /** The node running the task. Read from the UPID. */
  node: string
  /** The PVE task type (qmigrate, vzmigrate...). Read from the UPID. */
  type: string
  /** The PVE user of the task. Read from the UPID. */
  user: string
  /** The guest the task runs on, when the UPID names one. */
  entity: string | null
  /** Title of the viewer. Falls back to the translated task type. */
  description: string
}

/** Build the viewer request for a task that has just been started. Null when `upid` is not a UPID. */
export function taskViewerRequest(input: { upid: unknown; connectionId: string; description?: string }): TaskViewerRequest | null {
  const parsed = parseUpid(input.upid)

  if (!parsed || !input.connectionId) return null

  // UPID:<node>:<pid>:<pstart>:<starttime>:<type>:<id>:<user>:
  const fields = parsed.upid.split(':')

  return {
    upid: parsed.upid,
    connectionId: input.connectionId,
    node: parsed.node,
    type: fields[5] || '',
    entity: fields[6] || null,
    user: fields[7] || '',
    description: input.description || '',
  }
}

/** Ask the taskbar to show a task. Returns false when there was nothing to show. */
export function openTaskViewer(input: { upid: unknown; connectionId: string; description?: string }): boolean {
  const detail = taskViewerRequest(input)

  if (!detail || typeof window === 'undefined') return false
  window.dispatchEvent(new CustomEvent<TaskViewerRequest>(OPEN_TASK_VIEWER_EVENT, { detail }))

  return true
}
