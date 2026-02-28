import { useState, useEffect, useCallback, useRef } from 'react'

async function fetchJson(url: string, init?: RequestInit) {
  const r = await fetch(url, init)
  const text = await r.text()
  let json = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {}

  if (!r.ok) throw new Error(json?.error || text || `HTTP ${r.status}`)

  return json
}

interface AISettingsState {
  enabled: boolean
  provider: string
  ollamaUrl: string
  ollamaModel: string
  openaiKey: string
  openaiBaseUrl: string
  openaiModel: string
  anthropicKey?: string
  anthropicModel?: string
}

const defaultSettings: AISettingsState = {
  enabled: false,
  provider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'mistral:7b',
  openaiKey: '',
  openaiBaseUrl: '',
  openaiModel: 'gpt-4.1-nano',
}

export function useAISettings() {
  const [settings, setSettings] = useState<AISettingsState>(defaultSettings)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ type: string; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/settings/ai')

      if (res.ok) {
        const json = await res.json()

        if (json?.data) {
          setSettings(s => ({ ...s, ...json.data }))
        }
      }
    } catch (e) {
      console.error('Failed to load AI settings', e)
    }
  }, [])

  const saveSettings = useCallback(async () => {
    setSaving(true)

    try {
      await fetchJson('/api/v1/settings/ai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      return { success: true } as const
    } catch (e: any) {
      return { success: false, error: e?.message } as const
    } finally {
      setSaving(false)
    }
  }, [settings])

  const testConnection = useCallback(async () => {
    setTesting(true)
    setTestResult(null)

    try {
      const res = await fetch('/api/v1/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      const json = await res.json()

      if (res.ok) {
        return { success: true, response: json.response } as const
      } else {
        return { success: false, error: json?.error } as const
      }
    } catch (e: any) {
      return { success: false, error: e?.message } as const
    } finally {
      setTesting(false)
    }
  }, [settings])

  const loadModels = useCallback(async () => {
    const { provider, ollamaUrl, openaiKey, openaiBaseUrl, anthropicKey } = settings

    // Check required fields per provider
    if (provider === 'ollama' && !ollamaUrl) return
    if (provider === 'openai' && !openaiKey) return
    if (provider === 'anthropic' && !anthropicKey) return

    setLoadingModels(true)

    try {
      const res = await fetch('/api/v1/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ollamaUrl, openaiKey, openaiBaseUrl, anthropicKey }),
      })

      const json = await res.json()

      if (json?.models?.length > 0) {
        setAvailableModels(json.models)
      }
    } catch (e) {
      console.error('Failed to load models', e)
    } finally {
      setLoadingModels(false)
    }
  }, [settings])

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Debounced auto-load models when provider/URL/key change
  useEffect(() => {
    const { provider, ollamaUrl, openaiKey, anthropicKey } = settings

    // Clear models when conditions not met
    if (
      (provider === 'ollama' && !ollamaUrl) ||
      (provider === 'openai' && !openaiKey) ||
      (provider === 'anthropic' && !anthropicKey)
    ) {
      setAvailableModels([])

      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(() => {
      loadModels()
    }, 500)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [settings.provider, settings.ollamaUrl, settings.openaiKey, settings.openaiBaseUrl, settings.anthropicKey, loadModels])

  return {
    settings,
    setSettings,
    testing,
    testResult,
    setTestResult,
    saving,
    availableModels,
    loadingModels,
    loadSettings,
    saveSettings,
    testConnection,
    loadModels,
  }
}
