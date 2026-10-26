/**
 * Reads a positive millisecond budget from the environment, falling back when
 * the variable is absent or not a usable number.
 */
export function readTimeoutEnv(name: string, fallback: number, tag: string): number {
  const raw = process.env[name]
  if (!raw) return fallback

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[${tag}] Ignoring invalid ${name}="${raw}", using ${fallback}ms instead`)
    return fallback
  }

  return parsed
}
