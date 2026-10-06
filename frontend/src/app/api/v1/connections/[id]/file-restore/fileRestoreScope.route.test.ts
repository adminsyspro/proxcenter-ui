import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock, authorizeMock, getConnectionByIdMock, checkPermissionMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  authorizeMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

vi.mock('undici', () => ({ request: requestMock }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ getInsecureAgent: () => undefined }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { BACKUP_VIEW: 'backup.view' },
}))
vi.mock('@/lib/vdc/fileRestoreScope', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/vdc/fileRestoreScope')>()),
  authorizeFileRestore: authorizeMock,
}))

import { GET as listGET } from './route'
import { GET as downloadGET } from './download/route'
import { GET as previewGET } from './preview/route'

const SNAP = 'backup/vm/101/2026-01-15T10:00:00Z'

const RESOURCES = [
  { type: 'node', node: 'pve1', status: 'online' },
  { type: 'node', node: 'pve2', status: 'online' },
  { type: 'storage', node: 'pve1', storage: 'pbs-acme', status: 'available' },
  { type: 'storage', node: 'pve2', storage: 'pbs-acme', status: 'available' },
]

function pveResponse(json: unknown, contentType = 'application/json') {
  const text = typeof json === 'string' ? json : JSON.stringify(json)
  const buf = Buffer.from(text)
  return {
    statusCode: 200,
    headers: { 'content-type': contentType },
    body: {
      text: async () => text,
      async *[Symbol.asyncIterator]() { yield buf },
    },
  }
}

function routeRequest(path: string, query: Record<string, string>) {
  return new Request(`http://localhost/api/v1/connections/conn-1/file-restore${path}?${new URLSearchParams(query)}`)
}

const ROUTES = [
  { name: 'list', path: '', handler: listGET, filepath: '/' },
  { name: 'download', path: '/download', handler: downloadGET, filepath: '/etc/hosts' },
  { name: 'preview', path: '/preview', handler: previewGET, filepath: '/etc/hosts.conf' },
] as const

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: 'conn-1', baseUrl: 'https://pve:8006', apiToken: 't', insecureDev: false })
  requestMock.mockImplementation(async (url: string) =>
    url.endsWith('/cluster/resources')
      ? pveResponse({ data: RESOURCES })
      : url.includes('/file-restore/list')
        ? pveResponse({ data: [] })
        : pveResponse('hello', 'text/plain'))
})

describe.each(ROUTES)('file-restore $name route', ({ path, handler, filepath }) => {
  const ctx = { params: { id: 'conn-1' } }
  const query = { storage: 'pbs-other', volume: `pbs-other:${SNAP}`, filepath }

  it('checks the tenant scope and makes no Proxmox request when refused', async () => {
    authorizeMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Backup not accessible' }), { status: 403 }))

    const res = await handler(routeRequest(path, query), ctx)

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Backup not accessible' })
    expect(authorizeMock).toHaveBeenCalledWith('conn-1', 'pbs-other', `pbs-other:${SNAP}`)
    expect(requestMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('forwards the authorised volume id on an allowed node', async () => {
    authorizeMock.mockResolvedValue({ volumeId: `pbs-acme:${SNAP}`, allowedNodes: new Set(['pve2']) })

    const res = await handler(routeRequest(path, { storage: 'pbs-acme', volume: SNAP, filepath }), ctx)

    expect(res.status).toBe(200)
    const call = requestMock.mock.calls.find(([u]) => String(u).includes('/file-restore/'))
    expect(call).toBeDefined()
    const target = new URL(String(call![0]))
    expect(target.pathname).toBe('/api2/json/nodes/pve2/storage/pbs-acme/file-restore/' + (path === '' ? 'list' : 'download'))
    expect(target.searchParams.get('volume')).toBe(`pbs-acme:${SNAP}`)
  })

  it('refuses when none of the allowed nodes is usable', async () => {
    authorizeMock.mockResolvedValue({ volumeId: `pbs-acme:${SNAP}`, allowedNodes: new Set(['pve9']) })

    const res = await handler(routeRequest(path, { storage: 'pbs-acme', volume: SNAP, filepath }), ctx)

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Backup not accessible' })
    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(String(requestMock.mock.calls[0][0])).toMatch(/\/cluster\/resources$/)
  })
})
