import { describe, expect, it } from 'vitest'

import { blankVmVdcs } from './blankVms'

const vdc = (over: Record<string, unknown>) => ({
  id: 'a', name: 'Alpha', connectionId: 'conn-1', enabled: true, allowBlankVms: true, ...over,
})

describe('blankVmVdcs (#1171)', () => {
  const list = [
    vdc({ id: 'a' }),
    vdc({ id: 'b', allowBlankVms: false }),
    vdc({ id: 'c', enabled: false }),
    vdc({ id: 'd', connectionId: undefined, connection_id: 'conn-2' }),
    vdc({ id: 'e', connectionId: undefined }),
  ]

  it('keeps the active vDCs open to blank VMs, whatever the connection key', () => {
    expect(blankVmVdcs(list, null).map(v => v.id)).toEqual(['a', 'd'])
  })

  it('narrows to the context vDC, which may itself refuse blank VMs', () => {
    expect(blankVmVdcs(list, 'd').map(v => v.id)).toEqual(['d'])
    expect(blankVmVdcs(list, 'b')).toEqual([])
  })

  it('ignores a context that names no active vDC of the tenant', () => {
    expect(blankVmVdcs(list, 'c').map(v => v.id)).toEqual(['a', 'd'])
    expect(blankVmVdcs(list, 'zzz').map(v => v.id)).toEqual(['a', 'd'])
  })
})
