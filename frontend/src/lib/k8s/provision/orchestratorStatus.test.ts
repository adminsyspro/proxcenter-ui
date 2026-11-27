import { describe, it, expect } from 'vitest'
import { orchestratorStatus, orchestratorFailure, failureBody } from './orchestratorStatus'

describe('orchestratorStatus', () => {
  it('passes on the statuses a caller can act on', () => {
    for (const s of [400, 403, 404, 409, 422]) {
      expect(orchestratorStatus(`Orchestrator ${s}: x`)).toBe(s)
    }
  })
  it('maps a server fault, a network failure and a missing message to 502', () => {
    expect(orchestratorStatus('Orchestrator 500: internal error')).toBe(502)
    expect(orchestratorStatus('Orchestrator unavailable')).toBe(502)
    expect(orchestratorStatus(undefined)).toBe(502)
  })
})

describe('orchestratorFailure', () => {
  it('reads the code the orchestrator answers a refusal with', () => {
    expect(orchestratorFailure('Orchestrator 409: {"error":"another kubernetes deployment is in progress","code":"connection_busy"}'))
      .toEqual({ status: 409, code: 'connection_busy', message: undefined })
    expect(orchestratorFailure('Orchestrator 422: {"error":"ssh access ...","code":"ssh_access_required"}').code).toBe('ssh_access_required')
    expect(orchestratorFailure('Orchestrator 403: {"error":"excluded","code":"CONNECTION_LICENSE_EXCLUDED"}').code).toBe('CONNECTION_LICENSE_EXCLUDED')
  })
  it('keeps the sentence of a validation refusal, which the caller can correct', () => {
    expect(orchestratorFailure('Orchestrator 400: {"error":"invalid provision request: pod cidr 10.42.0.0/16 overlaps the node network","code":"invalid_request"}'))
      .toEqual({ status: 400, code: 'invalid_request', message: 'invalid provision request: pod cidr 10.42.0.0/16 overlaps the node network' })
  })
  it('falls back on the status when the body carries no known code', () => {
    expect(orchestratorFailure('Orchestrator 404: {"error":"provisioning run not found"}')).toEqual({ status: 404, code: 'not_found', message: undefined })
    expect(orchestratorFailure('Orchestrator 409: run is already destroying')).toEqual({ status: 409, code: 'conflict', message: undefined })
    expect(orchestratorFailure('Orchestrator 400: {"error":"x","code":"made_up"}').code).toBe('invalid_request')
  })
  it('never passes on the text of a server fault', () => {
    expect(orchestratorFailure('Orchestrator 500: {"error":"pq: password authentication failed for user"}')).toEqual({ status: 502, code: 'unavailable' })
    expect(orchestratorFailure('Orchestrator unavailable')).toEqual({ status: 502, code: 'unavailable' })
  })
})

describe('failureBody', () => {
  it('answers with the code, and the message only when there is one', () => {
    expect(failureBody({ status: 409, code: 'connection_busy' })).toEqual({ error: 'connection_busy' })
    expect(failureBody({ status: 400, code: 'invalid_request', message: 'm' })).toEqual({ error: 'invalid_request', message: 'm' })
  })
})
