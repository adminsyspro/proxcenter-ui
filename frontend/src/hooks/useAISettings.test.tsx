import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'

import { useAISettings } from './useAISettings'

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
    const url = String(input)

    if (url === '/api/v1/settings/ai') {
      return { ok: true, json: async () => ({ data: { enabled: true, provider: 'ollama', ollamaUrl: 'http://10.42.0.50:11434' } }) } as any
    }
    if (url === '/api/v1/ai/models') {
      return { ok: true, json: async () => ({ models: ['mistral:7b', 'llama3.1:8b'], toolCalling: { 'mistral:7b': false, 'llama3.1:8b': true } }) } as any
    }

    return { ok: false, json: async () => ({}) } as any
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useAISettings', () => {
  it('loads the saved settings on mount', async () => {
    const { result } = renderHook(() => useAISettings())

    await waitFor(() => expect(result.current.settings.enabled).toBe(true))
    expect(result.current.settings.ollamaUrl).toBe('http://10.42.0.50:11434')
    // The default when nothing is saved: the smallest qualified model (#459).
    expect(result.current.settings.ollamaModel).toBe('qwen3.5:9b')
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/settings/ai')
  })

  it('auto-loads the provider models after the debounce', async () => {
    const { result } = renderHook(() => useAISettings())

    await waitFor(() => expect(result.current.availableModels).toEqual(['mistral:7b', 'llama3.1:8b']), { timeout: 3000 })

    const modelsCall = fetchSpy.mock.calls.find(c => c[0] === '/api/v1/ai/models')!
    expect(JSON.parse((modelsCall[1] as any).body)).toMatchObject({ provider: 'ollama', ollamaUrl: 'http://10.42.0.50:11434' })
    expect(result.current.loadingModels).toBe(false)
    expect(result.current.modelToolCalling).toEqual({ 'mistral:7b': false, 'llama3.1:8b': true })
  })

  // #459: "Test connection" carries the preflight verdict, and a probe that
  // timed out keeps its code so the panel can say the model is still loading.
  it('passes the preflight verdict and the timeout code through', async () => {
    const preflight = { model: 'qwen3.5:9b', qualified: true, gpuShare: 1, tokensPerSecond: 30, issues: [], fits: ['qwen3.5:9b'] }

    fetchSpy.mockImplementation(async (input: any) => {
      if (String(input) === '/api/v1/ai/test') {
        return { ok: true, json: async () => ({ success: true, response: 'ok', toolCalling: true, preflight }) } as any
      }

      return { ok: false, json: async () => ({}) } as any
    })

    const { result } = renderHook(() => useAISettings())

    expect(await result.current.testConnection()).toEqual({ success: true, response: 'ok', toolCalling: true, preflight })

    fetchSpy.mockImplementation(async () => ({ ok: false, json: async () => ({ error: 'slow', code: 'probe-timeout' }) }) as any)

    expect(await result.current.testConnection()).toEqual({ success: false, error: 'slow', code: 'probe-timeout' })
  })
})
