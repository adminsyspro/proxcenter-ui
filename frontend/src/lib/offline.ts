// PROXCENTER_OFFLINE marks an air-gapped instance (ui#956). It is written by
// install-airgap.sh and read on the server only; the client learns it through
// /api/v1/license/status. Anything that would reach the internet checks it
// first: the GitHub version check, the stars badge, the catalog refresh, and
// the maps, which explain the missing tiles instead of showing a blank canvas.

export type EnvLike = Record<string, string | undefined>

const TRUTHY = new Set(['1', 'true', 'yes'])

export function isOfflineMode(env: EnvLike = process.env): boolean {
  return TRUTHY.has((env.PROXCENTER_OFFLINE ?? '').trim().toLowerCase())
}
