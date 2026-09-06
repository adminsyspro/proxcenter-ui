/**
 * Unit tests for hardware/utils.ts: fetchNextVmid and the VMID scoping helpers.
 *
 * Runs in the jsdom lane (MSW-backed fetch) because fetchNextVmid is a
 * browser-side wrapper around the /cluster/nextid API route. Each case seeds
 * one MSW handler; handlers reset between tests via jsdom-setup.
 */

import { describe, it, expect } from 'vitest'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import {
  fetchNextVmid,
  usedVmidsOnConnection,
  nextVmidOnConnection,
  parsePropertyString,
  mappingNodes,
  mappingCoversNode,
  mappingIssues,
  usbMappingValue,
  pciMappingValue,
  isRawPassthrough,
  fetchResourceMappings,
  type ResourceMapping,
} from './utils'

const CONN_ID = 'conn-1'
const NEXTID_URL = `*/api/v1/connections/${CONN_ID}/cluster/nextid`

describe('fetchNextVmid', () => {
  it('returns the cluster next id on a successful response', async () => {
    server.use(http.get(NEXTID_URL, () => HttpResponse.json({ data: 142 })))
    await expect(fetchNextVmid(CONN_ID)).resolves.toBe(142)
  })

  it('returns null when the response is not ok', async () => {
    server.use(http.get(NEXTID_URL, () => HttpResponse.json({}, { status: 500 })))
    await expect(fetchNextVmid(CONN_ID)).resolves.toBeNull()
  })

  it('returns null when the id is below the 100 floor', async () => {
    server.use(http.get(NEXTID_URL, () => HttpResponse.json({ data: 42 })))
    await expect(fetchNextVmid(CONN_ID)).resolves.toBeNull()
  })

  it('returns null when the payload is not a finite number', async () => {
    server.use(http.get(NEXTID_URL, () => HttpResponse.json({ data: 'nope' })))
    await expect(fetchNextVmid(CONN_ID)).resolves.toBeNull()
  })

  it('returns null when the request throws (network error)', async () => {
    server.use(http.get(NEXTID_URL, () => HttpResponse.error()))
    await expect(fetchNextVmid(CONN_ID)).resolves.toBeNull()
  })
})

// Two clusters, both numbering from 100, so 107 exists on each. This is the
// shape of the environment in #724.
const TWO_CLUSTERS = [
  { connId: 'conn-1', vmid: 100 },
  { connId: 'conn-1', vmid: '105' },
  { connId: 'conn-2', vmid: 107 },
  { connId: 'conn-2', vmid: 108 },
]

describe('usedVmidsOnConnection', () => {
  it('ignores guests living on another connection (#724)', () => {
    expect(usedVmidsOnConnection(TWO_CLUSTERS, 'conn-1')).toEqual([100, 105])
    expect(usedVmidsOnConnection(TWO_CLUSTERS, 'conn-2')).toEqual([107, 108])
  })

  it('drops unparseable vmids instead of yielding 0', () => {
    expect(usedVmidsOnConnection([{ connId: 'c', vmid: 'lxc' }, { connId: 'c', vmid: 110 }], 'c')).toEqual([110])
  })

  it('keeps every connection when no connection is selected yet', () => {
    expect(usedVmidsOnConnection(TWO_CLUSTERS, undefined)).toEqual([100, 105, 107, 108])
  })

  it('is empty for a connection with no guests', () => {
    expect(usedVmidsOnConnection(TWO_CLUSTERS, 'conn-3')).toEqual([])
  })
})

describe('nextVmidOnConnection', () => {
  it('does not skip ahead because of another cluster (#724)', () => {
    expect(nextVmidOnConnection(TWO_CLUSTERS, 'conn-1')).toBe(106)
  })

  it('starts at the 100 floor on an empty cluster', () => {
    expect(nextVmidOnConnection(TWO_CLUSTERS, 'conn-3')).toBe(100)
  })

  it('never proposes below the 100 floor', () => {
    expect(nextVmidOnConnection([{ connId: 'c', vmid: 42 }], 'c')).toBe(100)
  })
})

/* ------------------------------------------------------------------ */
/* USB / PCI passthrough through resource mappings (#852)              */
/* ------------------------------------------------------------------ */

describe('parsePropertyString', () => {
  it('splits a positional head from keyed parameters', () => {
    expect(parsePropertyString('0000:01:00.0,pcie=1,rombar=0')).toEqual({
      head: '0000:01:00.0',
      params: { pcie: '1', rombar: '0' },
    })
  })

  it('reads a keyed-only value and treats bare flags as 1', () => {
    expect(parsePropertyString('mapping=gpu,pcie=1,x-vga')).toEqual({
      head: '',
      params: { mapping: 'gpu', pcie: '1', 'x-vga': '1' },
    })
    expect(parsePropertyString('')).toEqual({ head: '', params: {} })
  })
})

describe('resource mapping helpers', () => {
  const gpu: ResourceMapping = {
    id: 'gpu',
    description: 'Quadro',
    map: ['node=pve1,path=0000:01:00.0,id=10de:1c82', 'node=pve2,path=0000:02:00.0,id=10de:1c82'],
    checks: [{ severity: 'error', message: 'device 0000:01:00.0 not found' }],
  }

  it('lists the nodes a mapping covers', () => {
    expect(mappingNodes(gpu)).toEqual(['pve1', 'pve2'])
    expect(mappingCoversNode(gpu, 'pve2')).toBe(true)
    expect(mappingCoversNode(gpu, 'pve3')).toBe(false)
    expect(mappingCoversNode({ id: 'empty' }, 'pve1')).toBe(false)
  })

  it('collects the messages PVE reported for the checked node (checks for PCI, errors for USB)', () => {
    expect(mappingIssues(gpu)).toEqual(['device 0000:01:00.0 not found'])
    expect(mappingIssues({ id: 'tablet', errors: [{ severity: 'warning', message: 'No mapping for node pve1.\n' }] })).toEqual(['No mapping for node pve1.'])
    expect(mappingIssues({ id: 'legacy', error: [{ message: 'usb device not found' }] })).toEqual(['usb device not found'])
    expect(mappingIssues({ id: 'none' })).toEqual([])
  })

  it('builds the mapping config values PVE accepts from a non-root token', () => {
    expect(usbMappingValue('tablet', true)).toBe('mapping=tablet,usb3=1')
    expect(usbMappingValue('tablet', false)).toBe('mapping=tablet')
    expect(pciMappingValue('gpu', { pcie: true, rombar: true, primaryGpu: true })).toBe('mapping=gpu,pcie=1,rombar=1,x-vga=1')
    expect(pciMappingValue('gpu', { pcie: false, rombar: false, primaryGpu: false })).toBe('mapping=gpu')
  })

  it('tells a raw device (root@pam only) from a mapping or SPICE redirection', () => {
    expect(isRawPassthrough('usb', 'host=046d:c52b,usb3=1')).toBe(true)
    expect(isRawPassthrough('usb', 'host=1-2')).toBe(true)
    expect(isRawPassthrough('usb', 'spice,usb3=1')).toBe(false)
    expect(isRawPassthrough('usb', 'host=spice')).toBe(false)
    expect(isRawPassthrough('usb', 'mapping=tablet')).toBe(false)
    expect(isRawPassthrough('pci', '0000:01:00.0,pcie=1')).toBe(true)
    expect(isRawPassthrough('pci', 'host=0000:01:00.0')).toBe(true)
    expect(isRawPassthrough('pci', 'mapping=gpu,pcie=1')).toBe(false)
  })
})

describe('fetchResourceMappings', () => {
  const MAPPING_URL = `*/api/v1/connections/${CONN_ID}/cluster/mapping/usb`

  it('returns the mapping list and forwards the node to check', async () => {
    let requested = ''
    server.use(http.get(MAPPING_URL, ({ request }) => {
      requested = request.url

      return HttpResponse.json({ data: [{ id: 'tablet', map: ['node=pve1,id=0627:0001'] }] })
    }))

    await expect(fetchResourceMappings(CONN_ID, 'usb', 'pve1')).resolves.toEqual([
      { id: 'tablet', map: ['node=pve1,id=0627:0001'] },
    ])
    expect(requested).toContain('node=pve1')
  })

  it('returns an empty list when the payload carries no array', async () => {
    server.use(http.get(MAPPING_URL, () => HttpResponse.json({ data: null })))
    await expect(fetchResourceMappings(CONN_ID, 'usb')).resolves.toEqual([])
  })

  it('throws the API error so the dialog can show it', async () => {
    server.use(http.get(MAPPING_URL, () => HttpResponse.json({ error: 'PVE 501 /cluster/mapping/usb: not implemented' }, { status: 500 })))
    await expect(fetchResourceMappings(CONN_ID, 'usb')).rejects.toThrow(/not implemented/)
  })
})
