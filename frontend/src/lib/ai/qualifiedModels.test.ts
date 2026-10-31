import { describe, it, expect } from 'vitest'

import {
  DEFAULT_OLLAMA_MODEL,
  isQualifiedOllamaModel,
  preflightVerdict,
  QUALIFIED_OLLAMA_MODELS,
  SLOW_TOKENS_PER_SECOND,
} from './qualifiedModels'

const GB = 1e9

describe('qualified Ollama models', () => {
  it('defaults to the smallest qualified model, the one most servers can run', () => {
    expect(DEFAULT_OLLAMA_MODEL).toBe('qwen3.5:9b')
    expect(QUALIFIED_OLLAMA_MODELS[0].model).toBe(DEFAULT_OLLAMA_MODEL)

    const sizes = QUALIFIED_OLLAMA_MODELS.map(q => q.loadedGb)

    expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
  })

  // Measured on the lab (30/10/2026): llama3.1:8b misread every follow-up,
  // gemma4:12b invented figures without calling a tool.
  it('matches exact tags only, so a measured failure is never recommended', () => {
    expect(isQualifiedOllamaModel('qwen3.5:9b')).toBe(true)
    expect(isQualifiedOllamaModel('mistral-small3.2:24b')).toBe(true)
    expect(isQualifiedOllamaModel('llama3.1:8b')).toBe(false)
    expect(isQualifiedOllamaModel('gemma4:12b')).toBe(false)
    expect(isQualifiedOllamaModel('qwen3.5')).toBe(false)
  })
})

describe('preflight verdict', () => {
  it('is clean for a qualified model loaded whole on the GPU at a usable speed', () => {
    const verdict = preflightVerdict({
      model: 'qwen3.5:9b',
      sizeBytes: 6.15 * GB,
      sizeVramBytes: 6.15 * GB,
      tokensPerSecond: 30.34,
    })

    expect(verdict).toEqual({
      model: 'qwen3.5:9b',
      qualified: true,
      gpuShare: 1,
      tokensPerSecond: 30.3,
      issues: [],
      // Its measured footprint (6.15) sits under the recorded one (6.2): it
      // still fits the server it is running on.
      fits: ['qwen3.5:9b'],
    })
  })

  it('lists what fits largest first, from what the probed model proved is free', () => {
    const verdict = preflightVerdict({
      model: 'qwen3.6:35b-a3b',
      sizeBytes: 22.17 * GB,
      sizeVramBytes: 22.17 * GB,
      tokensPerSecond: 56,
    })

    expect(verdict.issues).toEqual([])
    expect(verdict.fits).toEqual(['qwen3.6:35b-a3b', 'mistral-small3.2:24b', 'qwen3.5:9b'])
  })

  it('flags a model spilling to the CPU and suggests only qualified models under what the GPU took', () => {
    const verdict = preflightVerdict({
      model: 'mistral-small3.2:24b',
      sizeBytes: 17.2 * GB,
      sizeVramBytes: 11 * GB,
      tokensPerSecond: 4,
    })

    expect(verdict.gpuShare).toBeCloseTo(0.64, 2)
    expect(verdict.issues).toEqual(['cpu-offload', 'slow'])
    expect(verdict.fits).toEqual(['qwen3.5:9b'])
  })

  it('suggests nothing when even the smallest qualified model would not fit', () => {
    const verdict = preflightVerdict({
      model: 'llama3.1:8b',
      sizeBytes: 7 * GB,
      sizeVramBytes: 2 * GB,
      tokensPerSecond: 3,
    })

    expect(verdict.issues).toEqual(['not-qualified', 'cpu-offload', 'slow'])
    expect(verdict.fits).toEqual([])
  })

  it('flags an unqualified model even when it runs well', () => {
    const verdict = preflightVerdict({ model: 'llama3.1:8b', sizeBytes: 7 * GB, sizeVramBytes: 7 * GB, tokensPerSecond: 36 })

    expect(verdict.issues).toEqual(['not-qualified'])
    expect(verdict.fits).toEqual(['qwen3.5:9b'])
  })

  it('treats the speed threshold as the first usable value', () => {
    const at = preflightVerdict({ model: 'qwen3.5:9b', sizeBytes: GB, sizeVramBytes: GB, tokensPerSecond: SLOW_TOKENS_PER_SECOND })
    const under = preflightVerdict({ model: 'qwen3.5:9b', sizeBytes: GB, sizeVramBytes: GB, tokensPerSecond: SLOW_TOKENS_PER_SECOND - 0.1 })

    expect(at.issues).toEqual([])
    expect(under.issues).toEqual(['slow'])
  })

  // The model may have been unloaded between the probe and /api/ps, or the
  // server may not report timings: unknown is never reported as a problem.
  it('reports unknown measures as null and raises nothing from them', () => {
    const verdict = preflightVerdict({ model: 'qwen3.5:9b', sizeBytes: null, sizeVramBytes: null, tokensPerSecond: null })

    expect(verdict).toEqual({
      model: 'qwen3.5:9b',
      qualified: true,
      gpuShare: null,
      tokensPerSecond: null,
      issues: [],
      fits: [],
    })
  })
})
