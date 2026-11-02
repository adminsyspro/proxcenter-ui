import { describe, expect, it } from 'vitest'

import { exporterHelp, isExporterFailure } from './exporterFailure'

describe('isExporterFailure', () => {
  it('accepts the three reasons only', () => {
    for (const r of ['refused', 'timeout', 'invalid']) expect(isExporterFailure(r), r).toBe(true)
    for (const r of ['boom', '', undefined, null, 7, {}]) expect(isExporterFailure(r)).toBe(false)
  })
})

describe('exporterHelp', () => {
  it('refused: its own message and the installation procedure', () => {
    expect(exporterHelp('refused', true)).toEqual({ messageKey: 'unreachableRefused', install: true })
  })

  it('timeout: its own message (the port reminder), no installation', () => {
    expect(exporterHelp('timeout', true)).toEqual({ messageKey: 'unreachableTimeout', install: false })
  })

  it('invalid: its own message, no installation', () => {
    expect(exporterHelp('invalid', true)).toEqual({ messageKey: 'unreachableInvalid', install: false })
  })

  it('no reason (older server) or no node to name: the generic message and the installation procedure', () => {
    for (const reason of [undefined, null] as const) expect(exporterHelp(reason, true)).toEqual({ messageKey: 'unreachable', install: true })
    expect(exporterHelp('timeout', false)).toEqual({ messageKey: 'unreachable', install: true })
  })
})
