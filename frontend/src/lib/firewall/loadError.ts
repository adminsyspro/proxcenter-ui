// src/lib/firewall/loadError.ts
// Turns a failed firewall fetch into the one-line message the Network
// Security page shows (#1022). The routes relay orchestrator failures as
// `Orchestrator 500: {"error":"..."}`, so the inner error is unwrapped.

const ORCHESTRATOR_ERROR = /^Orchestrator (\d+): (\{[\s\S]*\})$/

export function errorMessage(err: unknown): string {
  const message = String((err as { message?: string })?.message || err || 'Unknown error').trim()
  const match = ORCHESTRATOR_ERROR.exec(message)

  if (!match) return message

  try {
    const inner = JSON.parse(match[2])

    return typeof inner?.error === 'string' && inner.error ? inner.error : message
  } catch {
    return message
  }
}
