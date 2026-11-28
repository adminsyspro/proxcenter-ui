import { describe, expect, it } from 'vitest'

import { parseInitBody } from './initForm'

/* ui#1450: the parameters of `POST /nodes/{n}/ceph/init`. */

const base = { node: 'pve1', network: '10.42.0.0/24', size: 3, minSize: 2 }

describe('parseInitBody', () => {
  it('maps the body to the PVE fields', () => {
    expect(parseInitBody(base)).toEqual({ ok: true, params: { node: 'pve1', fields: { network: '10.42.0.0/24', size: '3', min_size: '2' } } })
    expect(parseInitBody({ ...base, clusterNetwork: '10.43.0.0/24' })).toMatchObject({ ok: true, params: { fields: { 'cluster-network': '10.43.0.0/24' } } })
    expect(parseInitBody({ ...base, network: 'fd00:42::/64' }).ok).toBe(true)
  })

  it('refuses a bad network, node or replica count', () => {
    for (const bad of [
      { ...base, network: '10.42.0.0/33' },
      { ...base, network: '10.42.0.0' },
      { ...base, network: '10.42.0.0/24; reboot' },
      { ...base, clusterNetwork: 'x/24' },
      { ...base, node: 'pve1;id' },
      { ...base, minSize: 1 },
      { ...base, minSize: 4 },
      { ...base, size: 8 },
    ]) expect(parseInitBody(bad).ok, JSON.stringify(bad)).toBe(false)
    expect(parseInitBody({ ...base, minSize: 1, allowSingleCopy: true }).ok).toBe(true)
  })
})
