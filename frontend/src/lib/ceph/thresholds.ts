export const CEPH_DEFAULT_NEARFULL_RATIO = 0.85
export const CEPH_DEFAULT_FULL_RATIO = 0.95

const DEFAULT_RATIOS: { nearfull: number; full: number } = Object.freeze({ nearfull: CEPH_DEFAULT_NEARFULL_RATIO, full: CEPH_DEFAULT_FULL_RATIO })

/** Seuils nearfull/full par defaut de Ceph (objet stable), ceux de toute la page. */
export function cephRatios(): { nearfull: number; full: number } {
  return DEFAULT_RATIOS
}
