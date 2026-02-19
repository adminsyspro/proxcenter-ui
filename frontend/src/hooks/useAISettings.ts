import { useState, useEffect, useCallback } from 'react'

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
  openaiModel: 'gpt-4.1-nano',
}

export function useAISettings() {
  const [settings, setSettings] = useState<AISettingsState>(defaultSettings)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ type: string; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)

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

  const loadOllamaModels = useCallback(async () => {
    setLoadingModels(true)

    try {
      const res = await fetch(`${settings.ollamaUrl}/api/tags`)

      if (res.ok) {
        const json = await res.json()
        const models = json?.models?.map((m: any) => m.name) || []

        setAvailableModels(models)
      }
    } catch (e) {
      console.error('Failed to load Ollama models', e)
    } finally {
      setLoadingModels(false)
    }
  }, [settings.ollamaUrl])

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Auto-load Ollama models when provider is ollama
  useEffect(() => {
    if (settings.provider === 'ollama' && settings.ollamaUrl) {
      loadOllamaModels()
    }
  }, [settings.provider, settings.ollamaUrl, loadOllamaModels])

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
    loadOllamaModels,
  }
}
