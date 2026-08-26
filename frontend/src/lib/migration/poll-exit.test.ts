import { describe, it, expect } from 'vitest'
import { interpretPollExit, MAX_CONSECUTIVE_POLL_FAILURES } from './poll-exit'

describe('interpretPollExit', () => {
  it('returns running for a successful RUNNING response', () => {
    expect(interpretPollExit({ success: true, output: 'RUNNING' })).toEqual({ state: 'running' })
  })

  it('returns exit code 0', () => {
    expect(interpretPollExit({ success: true, output: '0' })).toEqual({ state: 'exited', exitCode: 0 })
  })

  it('trims output before returning a nonzero exit code', () => {
    expect(interpretPollExit({ success: true, output: '18\n' })).toEqual({ state: 'exited', exitCode: 18 })
  })

  it('returns the error as the reason for a failed call', () => {
    const error = 'orchestrator SSH timeout (30s)'
    expect(interpretPollExit({ success: false, error })).toEqual({ state: 'unknown', reason: error })
  })

  it('returns an empty output reason for successful empty output', () => {
    expect(interpretPollExit({ success: true, output: '' })).toEqual({ state: 'unknown', reason: 'empty output' })
  })

  it('returns an unexpected output reason for unrecognized output', () => {
    const result = interpretPollExit({ success: true, output: 'garbage here' })
    expect(result).toEqual({ state: 'unknown', reason: expect.stringContaining('unexpected output') })
  })

  it('never trusts output from a failed call', () => {
    expect(interpretPollExit({ success: false, output: '0' })).toEqual({
      state: 'unknown',
      reason: expect.any(String),
    })
  })
})

describe('MAX_CONSECUTIVE_POLL_FAILURES', () => {
  it('equals 5', () => {
    expect(MAX_CONSECUTIVE_POLL_FAILURES).toBe(5)
  })
})
