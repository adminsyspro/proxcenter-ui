import { describe, it, expect } from 'vitest'

import { parseHostPort, formatFingerprint } from './pbsFingerprint'

describe('pbsFingerprint helpers', () => {
  it('parses https://host:port', () => {
    expect(parseHostPort('https://pbs.example:8007')).toEqual({ host: 'pbs.example', port: 8007 })
  })
  it('defaults to 8007 when port missing', () => {
    expect(parseHostPort('https://pbs.example')).toEqual({ host: 'pbs.example', port: 8007 })
  })
  it('strips path', () => {
    expect(parseHostPort('https://pbs.example:8007/api2/json')).toEqual({ host: 'pbs.example', port: 8007 })
  })
  it('throws on non-https', () => {
    expect(() => parseHostPort('http://pbs.example')).toThrow(/https required/i)
  })
  it('formats raw hash as colon-separated uppercase', () => {
    const raw = 'aabbccdd'

    expect(formatFingerprint(raw)).toBe('AA:BB:CC:DD')
  })
})
