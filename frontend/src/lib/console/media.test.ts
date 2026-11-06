import { describe, expect, it, vi } from 'vitest'

import { isCdromMediaChange } from '../proxmox/cdrom'

import {
  EMPTY_MEDIA,
  applyConsoleMedia,
  guestApiBase,
  isoFileName,
  listOpticalDrives,
  loadConsoleMedia,
  mediaChangeBody,
  mediaOptionGroups,
  slotLabel,
  type FetchLike,
  type GuestRef,
} from './media'

const REF: GuestRef = { connId: 'c 1', type: 'qemu', node: 'pve1', vmid: '110' }

type Route = { status?: number; body?: unknown; throws?: boolean }

function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; init?: Parameters<FetchLike>[1] }[] = []
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const key = `${init?.method ?? 'GET'} ${url}`
    const route = routes[key]

    if (!route) throw new Error(`unexpected ${key}`)
    if (route.throws) throw new Error('network down')
    const status = route.status ?? 200

    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (route.body === undefined) throw new SyntaxError('not json')

        return route.body
      },
    }
  }

  return { fn: vi.fn(fn), calls }
}

describe('slotLabel / isoFileName', () => {
  it('names bus slots like the Hardware tab', () => {
    expect(slotLabel('ide2')).toBe('IDE 2')
    expect(slotLabel('sata0')).toBe('SATA 0')
    expect(slotLabel('scsi10')).toBe('SCSI 10')
    expect(slotLabel('weird')).toBe('weird')
  })

  it('keeps the path below iso/', () => {
    expect(isoFileName('local:iso/debian.iso')).toBe('debian.iso')
    expect(isoFileName('nfs:iso/win/virtio-win.iso')).toBe('win/virtio-win.iso')
    expect(isoFileName('not-a-volid')).toBe('not-a-volid')
  })
})

describe('listOpticalDrives', () => {
  it('returns nothing without a config', () => {
    expect(listOpticalDrives(null)).toEqual([])
    expect(listOpticalDrives(undefined)).toEqual([])
  })

  it('finds ISO, empty and host drives, sorted by bus then index', () => {
    const drives = listOpticalDrives({
      scsi0: 'local-lvm:vm-110-disk-0,size=32G',
      sata1: 'none,media=cdrom',
      ide10: 'local:iso/b.iso,media=cdrom',
      ide2: 'local:iso/a.iso,media=cdrom,size=100M',
      ide0: 'cdrom',
      ide3: 'local-lvm:vm-110-cloudinit,media=cdrom',
      net0: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0',
      digest: 'abc',
    })

    expect(drives.map(d => [d.slot, d.kind, d.volid])).toEqual([
      ['ide0', 'physical', null],
      ['ide2', 'iso', 'local:iso/a.iso'],
      ['ide10', 'iso', 'local:iso/b.iso'],
      ['sata1', 'empty', null],
    ])
  })
})

describe('mediaChangeBody', () => {
  const drive = listOpticalDrives({ ide2: 'local:iso/a.iso,media=cdrom,size=100M,aio=native' })[0]

  it('swaps the medium only and keeps the drive options', () => {
    const body = mediaChangeBody(drive, 'nfs:iso/b.iso', 'dg')

    expect(body).toEqual({ ide2: 'nfs:iso/b.iso,media=cdrom,aio=native', digest: 'dg' })
    // The config route must classify it as a media change (vm.config.media).
    expect(isCdromMediaChange(drive.raw, body.ide2)).toBe(true)
  })

  it('ejects with "none" and omits a missing digest', () => {
    expect(mediaChangeBody(drive, EMPTY_MEDIA)).toEqual({ ide2: 'none,media=cdrom,aio=native' })
  })

  it('mounts an ISO in a host drive', () => {
    const host = listOpticalDrives({ ide0: 'cdrom' })[0]
    const body = mediaChangeBody(host, 'local:iso/a.iso')

    expect(body.ide0).toBe('local:iso/a.iso,media=cdrom')
    expect(isCdromMediaChange(host.raw, body.ide0)).toBe(true)
  })

  it('refuses anything that is not an ISO volume', () => {
    expect(() => mediaChangeBody(drive, 'local-lvm:vm-110-disk-0')).toThrow()
  })
})

describe('mediaOptionGroups', () => {
  const storages = [{ storage: 'local', images: [{ volid: 'local:iso/a.iso', name: 'a.iso' }] }]

  it('returns the listing as is when the mounted ISO is in it', () => {
    const [drive] = listOpticalDrives({ ide2: 'local:iso/a.iso,media=cdrom' })

    expect(mediaOptionGroups(drive, storages)).toEqual(storages)
  })

  it('adds an unlisted mounted ISO to its storage group', () => {
    const [drive] = listOpticalDrives({ ide2: 'local:iso/z.iso,media=cdrom' })
    const groups = mediaOptionGroups(drive, storages)

    expect(groups[0].images.map(i => i.volid)).toEqual(['local:iso/z.iso', 'local:iso/a.iso'])
    // The caller's listing is not mutated.
    expect(storages[0].images).toHaveLength(1)
  })

  it('adds a group for a storage the user cannot list', () => {
    const [drive] = listOpticalDrives({ ide2: 'hidden:iso/z.iso,media=cdrom' })

    expect(mediaOptionGroups(drive, storages).map(g => g.storage)).toEqual(['hidden', 'local'])
  })

  it('adds nothing for an empty drive', () => {
    const [drive] = listOpticalDrives({ ide2: 'none,media=cdrom' })

    expect(mediaOptionGroups(drive, [])).toEqual([])
  })
})

describe('guestApiBase', () => {
  it('encodes every segment and accepts another node', () => {
    expect(guestApiBase(REF)).toBe('/api/v1/connections/c%201/guests/qemu/pve1/110')
    expect(guestApiBase(REF, 'pve2')).toBe('/api/v1/connections/c%201/guests/qemu/pve2/110')
  })
})

const CONFIG_URL = 'GET /api/v1/connections/c%201/guests/qemu/pve1/110/config'
const STORAGES_URL = 'GET /api/v1/connections/c%201/nodes/pve1/storages?content=iso'
const content = (node: string, storage: string) =>
  `GET /api/v1/connections/c%201/nodes/${node}/storage/${storage}/content?content=iso`

describe('loadConsoleMedia', () => {
  it('reads the drives, then every ISO storage of the node', async () => {
    const { fn } = fakeFetch({
      [CONFIG_URL]: { body: { data: { ide2: 'local:iso/a.iso,media=cdrom', digest: 'd1' } } },
      [STORAGES_URL]: {
        body: {
          data: [
            { storage: 'nfs', content: 'iso,vztmpl' },
            { storage: 'local', content: 'iso' },
            { storage: 'local', content: 'iso' },
            { storage: 'lvm', content: 'images' },
            { content: 'iso' },
          ],
        },
      },
      [content('pve1', 'local')]: {
        body: { data: [{ volid: 'local:iso/z.iso' }, { volid: 'local:iso/a.iso' }, { volid: 'local:vztmpl/x.tar' }, {}] },
      },
      [content('pve1', 'nfs')]: { status: 500, body: { error: 'down' } },
    })

    const state = await loadConsoleMedia(fn, REF)

    expect(state.node).toBe('pve1')
    expect(state.digest).toBe('d1')
    expect(state.drives).toHaveLength(1)
    expect(state.storages).toEqual([
      { storage: 'local', images: [{ volid: 'local:iso/a.iso', name: 'a.iso' }, { volid: 'local:iso/z.iso', name: 'z.iso' }] },
      { storage: 'nfs', images: [] },
    ])
  })

  it('skips the storage reads when the VM has no optical drive', async () => {
    const { fn, calls } = fakeFetch({ [CONFIG_URL]: { body: { data: { scsi0: 'local-lvm:vm-110-disk-0' } } } })
    const state = await loadConsoleMedia(fn, REF)

    expect(state.drives).toEqual([])
    expect(state.digest).toBeUndefined()
    expect(calls).toHaveLength(1)
  })

  it('follows a VM that moved to another node', async () => {
    const { fn } = fakeFetch({
      [CONFIG_URL]: { body: { data: { ide2: 'none,media=cdrom' }, movedTo: 'pve2' } },
      'GET /api/v1/connections/c%201/nodes/pve2/storages?content=iso': { body: { data: [{ storage: 'local', content: 'iso' }] } },
      [content('pve2', 'local')]: { throws: true },
    })
    const state = await loadConsoleMedia(fn, REF)

    expect(state.node).toBe('pve2')
    expect(state.storages).toEqual([{ storage: 'local', images: [] }])
  })

  it('treats an unreadable storage list as no storage', async () => {
    const { fn } = fakeFetch({
      [CONFIG_URL]: { body: { data: { ide2: 'none,media=cdrom' } } },
      [STORAGES_URL]: { status: 403, body: { error: 'Forbidden' } },
    })

    expect((await loadConsoleMedia(fn, REF)).storages).toEqual([])
  })

  it('accepts a content listing without data', async () => {
    const { fn } = fakeFetch({
      [CONFIG_URL]: { body: { data: { ide2: 'none,media=cdrom' } } },
      [STORAGES_URL]: { body: { data: [{ storage: 'local', content: 'iso' }] } },
      [content('pve1', 'local')]: { body: {} },
    })

    expect((await loadConsoleMedia(fn, REF)).storages).toEqual([{ storage: 'local', images: [] }])
  })

  it('surfaces the route error when the config cannot be read', async () => {
    const { fn } = fakeFetch({ [CONFIG_URL]: { status: 403, body: { error: 'Permission denied' } } })

    await expect(loadConsoleMedia(fn, REF)).rejects.toThrow('Permission denied')
  })

  it('falls back to the status when the error is not JSON', async () => {
    const { fn } = fakeFetch({ [CONFIG_URL]: { status: 502 } })

    await expect(loadConsoleMedia(fn, REF)).rejects.toThrow('HTTP 502')
  })

  it('handles a config response without data', async () => {
    const { fn } = fakeFetch({ [CONFIG_URL]: { body: {} } })

    expect((await loadConsoleMedia(fn, REF)).drives).toEqual([])
  })
})

describe('applyConsoleMedia', () => {
  const [drive] = listOpticalDrives({ ide2: 'local:iso/a.iso,media=cdrom' })
  const PUT = 'PUT /api/v1/connections/c%201/guests/qemu/pve2/110/config'

  it('PUTs the media change with the digest on the resolved node', async () => {
    const { fn, calls } = fakeFetch({ [PUT]: { body: { data: null } } })

    await applyConsoleMedia(fn, REF, { node: 'pve2', digest: 'd1' }, drive, EMPTY_MEDIA)

    expect(calls[0].init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(calls[0].init?.body ?? '')).toEqual({ ide2: 'none,media=cdrom', digest: 'd1' })
  })

  it('throws the refusal of the route', async () => {
    const { fn } = fakeFetch({ [PUT]: { status: 409, body: { error: 'VM configuration changed; reload before saving' } } })

    await expect(applyConsoleMedia(fn, REF, { node: 'pve2', digest: 'old' }, drive, EMPTY_MEDIA))
      .rejects.toThrow('VM configuration changed')
    await expect(applyConsoleMedia(fn, REF, { node: 'pve2', digest: 'old' }, drive, EMPTY_MEDIA))
      .rejects.toMatchObject({ name: 'MediaChangeError', status: 409 })
  })

  it('ignores an error body without a message', async () => {
    const { fn } = fakeFetch({ [PUT]: { status: 403, body: { error: '' } } })

    await expect(applyConsoleMedia(fn, REF, { node: 'pve2', digest: undefined }, drive, EMPTY_MEDIA))
      .rejects.toThrow('HTTP 403')
  })
})
