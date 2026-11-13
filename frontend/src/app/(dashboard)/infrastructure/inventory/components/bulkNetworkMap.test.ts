/** ui#1333: the rows of the bulk network table and the request they make. */
import { describe, expect, it } from 'vitest'

import { buildNetworkMapPayload, mergeNetworkRows, rowTagInvalid } from './bulkNetworkMap'

describe('mergeNetworkRows', () => {
  it('keeps an edited row, preloads a saved one and starts the others on the default', () => {
    const rows = mergeNetworkRows(
      [{ name: 'DMZ', vmCount: 2 }, { name: 'LAN', vmCount: 5 }, { name: 'Backup', vmCount: 1 }],
      [{ source: 'LAN', bridge: 'vnetlan', vlanTag: 20 }, { source: 'DMZ', bridge: 'saved' }],
      [{ source: 'DMZ', vmCount: 1, bridge: 'vmbr9', vlanTag: '' }],
    )
    expect(rows).toEqual([
      { source: 'DMZ', vmCount: 2, bridge: 'vmbr9', vlanTag: '' },
      { source: 'LAN', vmCount: 5, bridge: 'vnetlan', vlanTag: '20' },
      { source: 'Backup', vmCount: 1, bridge: '', vlanTag: '' },
    ])
  })
})

describe('buildNetworkMapPayload', () => {
  const rows = [
    { source: 'DMZ', vmCount: 1, bridge: 'vnetdmz', vlanTag: '30' },
    { source: 'LAN', vmCount: 1, bridge: '', vlanTag: '' },
    { source: 'Mgmt', vmCount: 1, bridge: ' vmbr1 ', vlanTag: 'x' },
  ]

  it('sends the rows with a bridge, the tag only when the operator may set one', () => {
    expect(buildNetworkMapPayload(rows, true)).toEqual([{ source: 'DMZ', bridge: 'vnetdmz', vlanTag: 30 }, { source: 'Mgmt', bridge: 'vmbr1' }])
    expect(buildNetworkMapPayload(rows, false)).toEqual([{ source: 'DMZ', bridge: 'vnetdmz' }, { source: 'Mgmt', bridge: 'vmbr1' }])
    expect(buildNetworkMapPayload([rows[1]], true)).toBeUndefined()
  })

  it('flags a tag that is not a VLAN id', () => {
    expect(rowTagInvalid(rows[0])).toBe(false)
    expect(rowTagInvalid({ ...rows[0], vlanTag: '5000' })).toBe(true)
    expect(rowTagInvalid(rows[1])).toBe(false)
  })
})
