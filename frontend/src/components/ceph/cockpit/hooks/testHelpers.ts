export const jsonRes = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => ({ data }) })

/**
 * Simule l'onglet cache / visible (usePageVisible lit document.visibilityState).
 * A n'utiliser que dans un test qui n'importe pas SWR : SWR ecoute `visibilitychange` avec un
 * `setTimeout.bind(...)` qui recoit l'evenement comme delai (TimeoutNaNWarning).
 */
export function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Corps `/ceph/live` complet (la garde de forme refuse un corps partiel). */
export const liveBody = (at: number, status = 'HEALTH_OK') => ({
  health: { status, checks: [] },
  pg: { total: 1, clean: 1, byState: [] },
  osd: { total: 3, up: 3, in: 3 },
  io: { readOps: 0, writeOps: 0, readBytes: 0, writeBytes: 0 },
  recovery: { bytesPerSec: 0, objectsPerSec: 0, degraded: 0, misplaced: 0 },
  raw: { used: 0, total: 0 },
  at,
})

/** Corps `/ceph` (inventaire) minimal mais complet. */
export const inventoryBody = () => ({
  hasCeph: true,
  health: { status: 'HEALTH_OK', checks: [] },
  capacity: {},
  performance: {},
  pgs: { total: 0, states: [] },
  osds: { list: [] },
  monitors: { list: [] },
  pools: { list: [] },
  mds: { list: [] },
  managers: { active: null, standbys: [] },
})
