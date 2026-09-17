import { expect, it } from 'vitest'

import { ORCHESTRATOR_UNAVAILABLE, replicationErrorResponse } from './replicationError'

it.each([400, 409, 503])('preserves upstream status %i and its message', async status => {
  const response = replicationErrorResponse(new Error(`Orchestrator ${status}: {"error":"cleanup first"}`), 'fallback')
  expect(response.status).toBe(status)
  expect(await response.json()).toEqual({ error: 'cleanup first' })
})

it('retains unexpected error messages and supplies a fallback for untyped failures', async () => {
  expect(await replicationErrorResponse(new Error('offline'), 'fallback').json()).toEqual({ error: 'offline' })
  const response = replicationErrorResponse(null, 'fallback')
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'fallback' })
})

// A dropped connection is not a failed action: the orchestrator usually
// finished the work. The page needs the code to know it must refresh first.
it('answers 503 with the code when the orchestrator dropped the connection', async () => {
  const dropped = Object.assign(new Error('Orchestrator unavailable'), { code: ORCHESTRATOR_UNAVAILABLE })
  const response = replicationErrorResponse(dropped, 'fallback')
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ error: 'Orchestrator unavailable', code: 'ORCHESTRATOR_UNAVAILABLE' })
})

it('falls back to the caller message when the dropped connection carries none', async () => {
  const dropped = Object.assign(new Error(''), { code: ORCHESTRATOR_UNAVAILABLE })
  expect(await replicationErrorResponse(dropped, 'fallback').json()).toEqual({ error: 'fallback', code: 'ORCHESTRATOR_UNAVAILABLE' })
})
