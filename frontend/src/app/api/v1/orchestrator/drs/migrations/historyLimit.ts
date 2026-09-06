// The orchestrator applies its own default (100 rows) when no limit is sent,
// so anything unusable simply falls back to that. The cap keeps a client from
// asking the orchestrator for its whole table.
export const MAX_HISTORY_LIMIT = 500

export function parseHistoryLimit(raw: string | null): number | undefined {
  if (!raw) return undefined

  const n = Number.parseInt(raw, 10)

  if (!Number.isFinite(n) || n <= 0) return undefined

  return Math.min(n, MAX_HISTORY_LIMIT)
}
