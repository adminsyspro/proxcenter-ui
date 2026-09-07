import { expect, it } from 'vitest'

import { replicationErrorResponse } from './replicationError'

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
