// Status of a cluster node in the inventory's cluster tabs. A node in HA
// maintenance (typically the one a rolling update is working on) is up: it
// used to read "Offline" in red, with neither its version nor its updates.
const NODE_STATUS_META = {
  online: { label: 'updates.online', chipColor: 'success', icon: 'ri-checkbox-circle-fill', dot: 'success.main' },
  maintenance: { label: 'updates.maintenance', chipColor: 'warning', icon: 'ri-tools-line', dot: 'warning.main' },
  offline: { label: 'updates.offline', chipColor: 'error', icon: 'ri-close-circle-fill', dot: 'error.main' },
} as const

export function nodeStatusMeta(status?: string) {
  if (status === 'online' || status === 'maintenance') return NODE_STATUS_META[status]

  return NODE_STATUS_META.offline
}

/** Whether the node answers, so its updates and local guests can be read. */
export function isNodeReachable(status?: string) {
  return status === 'online' || status === 'maintenance'
}
