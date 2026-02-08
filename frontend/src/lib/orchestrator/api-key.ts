// Resolves the orchestrator API key from env var or auto-generated file
import { readFileSync } from 'fs'

let _cachedKey: string | null = null

export function getOrchestratorApiKey(): string {
  // Return cached key if already resolved successfully
  if (_cachedKey) return _cachedKey

  // 1. Check env var first
  if (process.env.ORCHESTRATOR_API_KEY) {
    _cachedKey = process.env.ORCHESTRATOR_API_KEY
    return _cachedKey
  }

  // 2. Try to read auto-generated key from shared orchestrator data volume
  const keyPaths = ['/app/orchestrator_data/.api-key', '/app/data/.api-key']
  for (const p of keyPaths) {
    try {
      const key = readFileSync(p, 'utf-8').trim()
      if (key.length >= 32) {
        _cachedKey = key
        return key
      }
    } catch { /* file not found, try next */ }
  }

  // Key not found yet — don't cache empty string so we retry next call
  return ''
}
