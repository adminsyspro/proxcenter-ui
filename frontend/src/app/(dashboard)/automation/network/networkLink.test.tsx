import { afterEach, describe, expect, it, vi } from 'vitest'

import { connectionOfVm, parseNetworkLink, pickConnection, readStoredConnection, storeConnection } from './networkLink'

const link = (search: string) => parseNetworkLink(new URLSearchParams(search))

describe('parseNetworkLink', () => {
  it('reads the tab, the connection and the Micro-segmentation sub-tab', () => {
    expect(link('tab=groups&connection=dr')).toEqual({ tab: 4, sub: null, connection: 'dr', vm: null })
    expect(link('tab=microseg&sub=history')).toEqual({ tab: 6, sub: 'history', connection: null, vm: null })
    expect(link('tab=firewalling&sub=history').sub).toBeNull()
    expect(link('tab=nope').tab).toBeNull()
    expect(parseNetworkLink(null)).toEqual({ tab: null, sub: null, connection: null, vm: null })
  })

  it('opens Micro-segmentation > Overview for a VMID, whatever tab and sub say; a VMID that is no number is ignored', () => {
    expect(link('vm=98010&tab=aliases&sub=drifts')).toEqual({ tab: 6, sub: 'overview', connection: null, vm: 98010 })
    expect(link('vm=abc').vm).toBeNull()
    expect(link('vm=%20').vm).toBeNull()
  })
})

describe('pickConnection', () => {
  const connections = [{ id: 'a' }, { id: 'b' }]
  it('takes the first candidate that exists, else the first connection', () => {
    expect(pickConnection(connections, [null, 'gone', 'b'])).toBe('b')
    expect(pickConnection(connections, [undefined, 'gone'])).toBe('a')
    expect(pickConnection([], ['a'])).toBe('')
  })
})

describe('connectionOfVm', () => {
  it('finds the connection whose inventory holds the VMID', () => {
    const tree = { data: { clusters: [{ id: 'a', nodes: [{ guests: [{ vmid: 1 }] }] }, { id: 'b', nodes: [{ guests: [{ vmid: '2' }] }] }] } }
    expect(connectionOfVm(tree, 2)).toBe('b')
    expect(connectionOfVm(tree, 3)).toBeNull()
    expect(connectionOfVm(undefined, 1)).toBeNull()
  })
})

describe('the remembered connection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('is kept in the browser', () => {
    expect(readStoredConnection()).toBeNull()
    storeConnection('dr')
    expect(readStoredConnection()).toBe('dr')
  })

  it('is simply not remembered when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => storeConnection('dr')).not.toThrow()
    expect(readStoredConnection()).toBeNull()
  })
})
