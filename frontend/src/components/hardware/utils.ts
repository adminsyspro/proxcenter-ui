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
