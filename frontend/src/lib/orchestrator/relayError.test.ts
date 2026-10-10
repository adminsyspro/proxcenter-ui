/**
 * The error answer of the orchestrator relays: a 4xx keeps its status and
 * message, anything else becomes a 500, and an unreachable orchestrator is
 * not logged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { relayOrchestratorError } from './relayError'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('relayOrchestratorError', () => {
  it('passes a validation error through with its status and message', async () => {
    const res = relayOrchestratorError(new Error('Orchestrator 422: {"error":"url is required"}'), 'fallback')

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'url is required' })
    expect(console.error).not.toHaveBeenCalled()
  })

  it('turns an upstream 5xx into a logged 500 carrying the error message', async () => {
    const err = new Error('Orchestrator 500: boom')
    const res = relayOrchestratorError(err, 'Failed to list')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Orchestrator 500: boom' })
    expect(console.error).toHaveBeenCalledWith('Failed to list', err)
  })

  it('does not log an unreachable orchestrator', async () => {
    const err = Object.assign(new Error('Orchestrator unavailable'), { code: 'ORCHESTRATOR_UNAVAILABLE' })
    const res = relayOrchestratorError(err, 'Failed to list')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Orchestrator unavailable' })
    expect(console.error).not.toHaveBeenCalled()
  })

  it('falls back to the given message when the error carries none', async () => {
    const res = relayOrchestratorError(null, 'Failed to create')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to create' })
  })
})
