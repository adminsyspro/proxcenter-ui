import { describe, it, expect } from 'vitest'
import { panelMessage } from './panelState'

describe('panelMessage', () => {
  it('forbidden -> warning with rbac key', () => {
    expect(panelMessage({ status: 'forbidden' })).toEqual({ tone: 'warning', key: 'forbidden' })
  })
  it('error with not_found -> info notFound', () => {
    expect(panelMessage({ status: 'error', errorCode: 'not_found' })).toEqual({ tone: 'info', key: 'notFound' })
  })
  it('error/unreachable -> error', () => {
    expect(panelMessage({ status: 'error', errorCode: 'unreachable' })).toEqual({ tone: 'error', key: 'unreachable' })
  })
  it('ok + truncated -> warning truncated', () => {
    expect(panelMessage({ status: 'ok', truncated: true })).toEqual({ tone: 'warning', key: 'truncated' })
  })
  it('ok + not truncated -> null', () => {
    expect(panelMessage({ status: 'ok' })).toBeNull()
  })
})
