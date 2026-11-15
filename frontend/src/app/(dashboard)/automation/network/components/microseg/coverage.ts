import type { MicrosegStatus } from '@/lib/microseg/types'

export type Coverage = { zoned: number; running: number; protected: number; members: number }

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

/**
 * The coverage figures of the banner, read from GET /status: running guests
 * that sit in a zone, and zone members that are really protected. Null while the
 * engine waits for its first full run (after a restart or a leader change): no
 * figure is invented then. A missing or malformed block reads as zeros.
 */
export function coverage(status: Pick<MicrosegStatus, 'coverage'>): Coverage | null {
  const raw = status.coverage
  if (raw === null) return null
  const running = count(raw?.running)
  const members = count(raw?.members)
  return {
    running,
    zoned: Math.min(count(raw?.zoned), running),
    members,
    protected: Math.min(count(raw?.protected), members),
  }
}
