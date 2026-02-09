import { useState, useEffect, useCallback } from 'react'

interface ServerSpecs {
  mode: string
  avgCoresPerServer: number
  avgRamPerServer: number
  tdpPerCore: number
  wattsPerGbRam: number
  wattsPerTbStorage: number
  storageType: string
  overheadPerServer: number
}

interface DisplayOptions {
  showCost: boolean
  showCo2: boolean
  showEquivalences: boolean
  showScore: boolean
}

interface GreenSettingsState {
  pue: number
  electricityPrice: number
  currency: string
  co2Country: string
  co2Factor: number
  serverSpecs: ServerSpecs
  display: DisplayOptions
}

const defaultSettings: GreenSettingsState = {
  pue: 1.4,
  electricityPrice: 0.18,
  currency: 'EUR',
  co2Country: 'france',
  co2Factor: 0.052,
  serverSpecs: {
    mode: 'auto',
    avgCoresPerServer: 64,
    avgRamPerServer: 256,
    tdpPerCore: 10,
    wattsPerGbRam: 0.375,
    wattsPerTbStorage: 6,
    storageType: 'mixed',
    overheadPerServer: 50,
  },
  display: {
    showCost: true,
    showCo2: true,
    showEquivalences: true,
    showScore: true,
  },
}

export function useGreenSettings() {
  const [settings, setSettings] = useState<GreenSettingsState>(defaultSettings)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null)

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/v1/settings/green')

      if (res.ok) {
        const json = await res.json()

        if (json?.data) {
          setSettings(s => ({ ...s, ...json.data }))
        }
      }
    } catch (e) {
      console.error('Failed to load green settings', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const saveSettings = useCallback(async () => {
    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/v1/settings/green', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      if (res.ok) {
        return { success: true } as const
      } else {
        return { success: false } as const
      }
    } catch (e: any) {
      return { success: false, error: e?.message } as const
    } finally {
      setSaving(false)
    }
  }, [settings])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  return {
    settings,
    setSettings,
    saving,
    loading,
    message,
    setMessage,
    loadSettings,
    saveSettings,
  }
}
