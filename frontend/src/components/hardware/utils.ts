// Types pour les storages
export type Storage = {
  storage: string
  type: string
  avail?: number
  total?: number
  content?: string
}

export type NodeInfo = {
  node: string
  status: string
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
}

export type StorageInfo = {
  storage: string
  type: string
  avail?: number
  total?: number
  shared?: number
  content?: string
}

// Fonctions utilitaires partagees entre MigrateVmDialog et CloneVmDialog

export const calculateNodeScore = (node: NodeInfo): number => {
  const cpuFree = node.maxcpu ? (1 - (node.cpu || 0)) * 100 : 50
  const memFree = node.maxmem && node.mem ? ((node.maxmem - node.mem) / node.maxmem) * 100 : 50


return cpuFree * 0.4 + memFree * 0.6
}

export const getRecommendedNode = (nodeList: NodeInfo[]): NodeInfo => {
  return nodeList.reduce((best, current) => {
    const bestScore = calculateNodeScore(best)
    const currentScore = calculateNodeScore(current)


return currentScore > bestScore ? current : best
  }, nodeList[0])
}

export const formatMemory = (bytes?: number): string => {
  if (!bytes) return '\u2014'
  const gb = bytes / 1024 / 1024 / 1024


return `${gb.toFixed(1)} GB`
}

// Cluster-wide next free VMID from PVE (/cluster/nextid). Returns null when the
// endpoint fails or yields something below the 100 floor, so callers can fall
// back to their own estimate. Used by CloneVmDialog (both its open-effect and
// the "next id" button) to match the "New VM" screen's next-available default.
export const fetchNextVmid = async (connId: string): Promise<number | null> => {
  try {
    const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/cluster/nextid`)

    if (!res.ok) return null
    const json = await res.json()
    const id = Number(json?.data)


return Number.isFinite(id) && id >= 100 ? id : null
  } catch {
    return null
  }
}
