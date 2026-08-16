import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/auth/principal', () => ({
  getPrincipal: vi.fn<() => Promise<any>>(),
  rejectionToResponse: (rejection: any) =>
    NextResponse.json(rejection?.body || { error: 'Invalid or expired API token' }, {
      status: rejection?.status || 401,
    }),
}))

import { GET } from './route'
import { getPrincipal } from '@/lib/auth/principal'
import { setProgress, clearProgress } from '@/lib/upload-progress'

const session = (userId: string) => ({
  ok: true,
  principal: { kind: 'session', userId, tenantId: 'tenant-1', connectionIds: null },
})

const transferring = { bytesSent: 512, totalBytes: 2048, status: 'transferring' as const }

const get = (uploadId: string) => callRoute(GET, { params: { uploadId } })

beforeEach(() => {
  vi.clearAllMocks()
  clearProgress('up-1')
  vi.mocked(getPrincipal).mockResolvedValue(session('user-1') as any)
})

describe('GET /api/v1/upload-progress/[uploadId]', () => {
  it('returns the progress of the user who started the upload', async () => {
    setProgress('up-1', transferring, 'user-1')

    const res = await get('up-1')

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual(transferring)
  })

  it('tells another user the id is unknown rather than serving it', async () => {
    setProgress('up-1', transferring, 'user-1')
    vi.mocked(getPrincipal).mockResolvedValue(session('user-2') as any)

    const res = await get('up-1')

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ bytesSent: 0, totalBytes: 0, status: 'unknown' })
  })

  it('answers an id that never existed the same way', async () => {
    const res = await get('never-existed')

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ bytesSent: 0, totalBytes: 0, status: 'unknown' })
  })

  it('refuses a caller without a session', async () => {
    setProgress('up-1', transferring, 'user-1')
    vi.mocked(getPrincipal).mockResolvedValue({ ok: true } as any)

    const res = await get('up-1')

    expect(res.status).toBe(401)
  })

  it('passes a principal rejection through untouched', async () => {
    vi.mocked(getPrincipal).mockResolvedValue({
      ok: false,
      rejection: { status: 405, body: { error: 'API tokens are read-only' } },
    } as any)

    const res = await get('up-1')

    expect(res.status).toBe(405)
    expect(await readJson<any>(res)).toEqual({ error: 'API tokens are read-only' })
  })
})
