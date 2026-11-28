import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))
vi.mock('./server', async (importActual) => ({
  ...(await importActual<typeof import('./server')>()),
  sshReady: vi.fn<(id: string) => Promise<boolean>>(async () => true),
}))

import { pveFetch } from '@/lib/proxmox/client'

import { handoverPreflightIssues } from './preflightIssues'

const pveFetchMock = pveFetch as any
const SOURCE = { id: 'prod', baseUrl: 'https://prod', apiToken: 't' } as any

function wire(options: Record<string, unknown> | Error) {
  pveFetchMock.mockImplementation(async (_conn: unknown, path: string) => {
    if (path.endsWith('/status/current')) return { status: 'stopped' }
    if (path === '/cluster/resources?type=vm') return []
    if (path === '/cluster/options') {
      if (options instanceof Error) throw options
      return options
    }
    throw new Error(`unexpected ${path}`)
  })
}

const run = (vmid = '91470') => handoverPreflightIssues({
  sourceConn: SOURCE,
  sourceConnectionId: 'prod',
  targetConnectionId: 'dr',
  node: 'pve1',
  type: 'qemu',
  vmid,
  config: { scsi0: 'Shared:vm-91470-disk-0,size=1G' },
})

const reusable = (issues: Awaited<ReturnType<typeof run>>) => issues.find(i => i.code === 'VMID_REUSABLE_ON_SOURCE')

beforeEach(() => {
  vi.clearAllMocks()
})

// ui#1460: once moved, the VMID is free on the source cluster; a guest given
// it there sees the moved disks on the shared storage as its own.
describe('handoverPreflightIssues: VMID handed out again by the source cluster', () => {
  it('warns when the source cluster keeps the default range of new IDs', async () => {
    wire({ keyboard: 'fr' })
    expect(reusable(await run())).toEqual(expect.objectContaining({
      type: 'warning',
      context: { vmid: '91470', lower: 100, last: 999999 },
    }))
  })

  it('warns when the VMID falls inside the configured range', async () => {
    wire({ 'next-id': { lower: '90000', upper: '100000' } })
    expect(reusable(await run())?.context).toEqual({ vmid: '91470', lower: 90000, last: 99999 })
  })

  it('stays quiet when the source cluster hands out IDs outside the VMID', async () => {
    wire({ 'next-id': { lower: '500000', upper: '600000' } })
    expect(reusable(await run())).toBeUndefined()
  })

  it('treats upper as exclusive, as Proxmox does', async () => {
    wire({ 'next-id': { lower: '100', upper: '91470' } })
    expect(reusable(await run())).toBeUndefined()
  })

  it('reads the property-string form too', async () => {
    wire({ 'next-id': 'lower=91000,upper=92000' })
    expect(reusable(await run())?.context).toEqual({ vmid: '91470', lower: 91000, last: 91999 })
  })

  it('says nothing when the options cannot be read', async () => {
    wire(new Error('PVE unreachable'))
    expect(reusable(await run())).toBeUndefined()
  })
})
