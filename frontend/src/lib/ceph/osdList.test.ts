import { describe, expect, it } from 'vitest'

import { osdUpInList } from './osdList'

// Shape of /nodes/{node}/ceph/osd: a CRUSH tree under `root`.
const TREE = {
  root: {
    id: -1, name: 'default', type: 'root',
    children: [
      { id: -3, name: 'AZ-A', type: 'datacenter', children: [
        { id: -5, name: 'pve-a', type: 'host', children: [
          { id: 0, type: 'osd', status: 'up', in: 1 },
          { id: 20, type: 'osd', status: 'up', in: 1 },
        ] },
      ] },
      { id: -4, name: 'AZ-B', type: 'datacenter', children: [
        { id: -6, name: 'pve-b', type: 'host', children: [
          { id: 3, type: 'osd', status: 'down', in: 1 },
          { id: 7, type: 'osd', status: 'up', in: 0, reweight: 0 },
        ] },
      ] },
    ],
  },
}

describe('osdUpInList', () => {
  it('keeps only OSDs, with their real ids, sorted, even when ids have gaps', () => {
    expect(osdUpInList(TREE)).toEqual([
      { id: 0, up: true, in: true },
      { id: 3, up: false, in: true },
      { id: 7, up: true, in: false },
      { id: 20, up: true, in: true },
    ])
  })

  it('accepts a flat list and numeric flags', () => {
    expect(osdUpInList([{ id: 1, up: 1, in: 1 }, { id: 0, up: 0, in: 0 }])).toEqual([
      { id: 0, up: false, in: false },
      { id: 1, up: true, in: true },
    ])
  })

  it('returns an empty list for an unknown answer', () => {
    expect(osdUpInList(null)).toEqual([])
    expect(osdUpInList({})).toEqual([])
  })
})
