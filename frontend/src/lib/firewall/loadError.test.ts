import { describe, expect, it } from 'vitest'

import { errorMessage } from './loadError'

describe('errorMessage', () => {
  it('unwraps the error an orchestrator failure carries', () => {
    // The orchestrator body ends with a newline, as Go's json.Encoder writes it.
    const err = new Error('Orchestrator 500: {"error":"failed to parse cluster rules: json: cannot unmarshal string into Go struct field FirewallRule.ipversion of type int"}\n')

    expect(errorMessage(err)).toBe('failed to parse cluster rules: json: cannot unmarshal string into Go struct field FirewallRule.ipversion of type int')
  })

  it('unwraps a license refusal', () => {
    const err = new Error('Orchestrator 403: {"error":"This feature requires a license","code":"FEATURE_REQUIRED","feature":"firewall"}')

    expect(errorMessage(err)).toBe('This feature requires a license')
  })

  it('keeps any other message as it is', () => {
    expect(errorMessage(new Error('HTTP 502'))).toBe('HTTP 502')
    expect(errorMessage(new Error('Orchestrator 500: not json'))).toBe('Orchestrator 500: not json')
    expect(errorMessage('boom')).toBe('boom')
  })

  it('keeps the whole message when the body carries no usable error', () => {
    expect(errorMessage(new Error('Orchestrator 500: {"code":"X"}'))).toBe('Orchestrator 500: {"code":"X"}')
    expect(errorMessage(new Error('Orchestrator 500: {"error":""}'))).toBe('Orchestrator 500: {"error":""}')
    expect(errorMessage(new Error('Orchestrator 500: {not json}'))).toBe('Orchestrator 500: {not json}')
  })

  it('names an error that carries nothing', () => {
    expect(errorMessage(undefined)).toBe('Unknown error')
    expect(errorMessage(new Error(''))).toBe('Error')
  })
})
