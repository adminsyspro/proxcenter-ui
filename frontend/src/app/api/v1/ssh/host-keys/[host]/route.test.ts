import { describe, expect, it, vi, beforeEach } from 'vitest'
import { callRoute, readJson, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const { checkPermissionMock, orchestratorFetchMock, forgetHostKeyMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  orchestratorFetchMock: vi.fn<(...a: any[]) => Promise<any>>(),
  forgetHostKeyMock: vi.fn<(host: string) => Promise<number>>(),
}))

// parseOrchestratorError stays REAL: telling "the orchestrator answered 404"
// apart from "the orchestrator never answered" is exactly what decides between
// a 404 and a 200 with orchestratorUnavailable, so the parser must be the one
// production uses.
vi.mock('@/lib/orchestrator', async () => {
  const actual = await vi.importActual<typeof import('@/lib/orchestrator')>('@/lib/orchestrator')
  return {
    ...actual,
    orchestratorFetch: (...args: unknown[]) => orchestratorFetchMock(...args),
  }
})

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  PERMISSIONS: {
    CONNECTION_VIEW: 'connection.view',
    CONNECTION_MANAGE: 'connection.manage',
  },
}))

vi.mock('@/lib/ssh/host-key-store', () => ({
  forgetHostKey: (host: string) => forgetHostKeyMock(host),
}))

import { DELETE } from './route'

/** The error shape orchestratorFetch throws on a non-OK upstream response. */
function orchestratorHttpError(status: number, body: string): Error {
  return new Error(`Orchestrator ${status}: ${body}`)
}

function unreachableError(): Error {
  const err: any = new Error('Orchestrator unavailable')
  err.code = 'ORCHESTRATOR_UNAVAILABLE'
  return err
}

function call(host: string) {
  return callRoute(DELETE as Parameters<typeof callRoute>[0], { method: 'DELETE', params: { host } })
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  orchestratorFetchMock.mockReset().mockResolvedValue({ status: 'forgotten', host: '10.42.0.101' })
  forgetHostKeyMock.mockReset().mockResolvedValue(0)
})

describe('DELETE /api/v1/ssh/host-keys/[host]', () => {
  it('clears both stores and reports what each one removed', async () => {
    forgetHostKeyMock.mockResolvedValue(2)

    const res = await call('10.42.0.101')

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      status: 'forgotten',
      host: '10.42.0.101',
      cleared: { orchestrator: true, frontendRows: 2 },
      orchestratorUnavailable: false,
    })
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/ssh/host-keys/10.42.0.101', { method: 'DELETE' })
    expect(forgetHostKeyMock).toHaveBeenCalledWith('10.42.0.101')
  })

  it('checks connection.manage, not connection.view', async () => {
    await call('10.42.0.101')

    expect(checkPermissionMock).toHaveBeenCalledWith('connection.manage')
  })

  it('returns the denied response and clears nothing when the permission check fails', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())

    const res = await call('10.42.0.101')

    expect(res.status).toBe(403)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
    expect(forgetHostKeyMock).not.toHaveBeenCalled()
  })

  it('still clears the frontend store when the orchestrator held no pin', async () => {
    orchestratorFetchMock.mockRejectedValue(
      orchestratorHttpError(404, '{"error":"no pinned host key for 10.42.0.101"}')
    )
    forgetHostKeyMock.mockResolvedValue(1)

    const res = await call('10.42.0.101')

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      status: 'forgotten',
      host: '10.42.0.101',
      cleared: { orchestrator: false, frontendRows: 1 },
      orchestratorUnavailable: false,
    })
    expect(forgetHostKeyMock).toHaveBeenCalledWith('10.42.0.101')
  })

  it('still clears the orchestrator when the frontend store held no pin', async () => {
    forgetHostKeyMock.mockResolvedValue(0)

    const res = await call('10.42.0.101')

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toMatchObject({ cleared: { orchestrator: true, frontendRows: 0 } })
  })

  it('returns 404 only when the orchestrator answered and BOTH stores held nothing', async () => {
    orchestratorFetchMock.mockRejectedValue(
      orchestratorHttpError(404, '{"error":"no pinned host key for 10.42.0.101"}')
    )
    forgetHostKeyMock.mockResolvedValue(0)

    const res = await call('10.42.0.101')

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: 'no pinned host key for 10.42.0.101' })
    // The frontend store is still asked, so a stale row can never survive a 404.
    expect(forgetHostKeyMock).toHaveBeenCalledWith('10.42.0.101')
  })

  it('never 404s when the orchestrator was unreachable, even with no frontend row', async () => {
    orchestratorFetchMock.mockRejectedValue(unreachableError())
    forgetHostKeyMock.mockResolvedValue(0)

    const res = await call('10.42.0.101')

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      status: 'forgotten',
      host: '10.42.0.101',
      cleared: { orchestrator: false, frontendRows: 0 },
      orchestratorUnavailable: true,
    })
    expect(forgetHostKeyMock).toHaveBeenCalledWith('10.42.0.101')
  })

  it('treats an orchestrator 503 (no host-key store) as unavailable rather than a clean clear', async () => {
    orchestratorFetchMock.mockRejectedValue(
      orchestratorHttpError(503, '{"error":"host key store unavailable"}')
    )
    forgetHostKeyMock.mockResolvedValue(1)

    const res = await call('10.42.0.101')

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toMatchObject({
      cleared: { orchestrator: false, frontendRows: 1 },
      orchestratorUnavailable: true,
    })
  })

  it.each([
    ['a colon', '10.42.0.101:22'],
    ['a slash', '10.42.0.101/22'],
    ['a space', 'pve 1'],
    ['nothing', '   '],
  ])('rejects a host containing %s with 400 and touches neither store', async (_label, host) => {
    const res = await call(host)

    expect(res.status).toBe(400)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
    expect(forgetHostKeyMock).not.toHaveBeenCalled()
  })

  it('rejects a host that is not a string at all with 400', async () => {
    const res = await callRoute(DELETE as Parameters<typeof callRoute>[0], { method: 'DELETE', params: { host: 22 as any } })

    expect(res.status).toBe(400)
    expect(forgetHostKeyMock).not.toHaveBeenCalled()
  })

  it('answers 500 with the reason when the frontend store itself fails', async () => {
    forgetHostKeyMock.mockRejectedValue(new Error('db down'))

    const res = await call('10.42.0.101')

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'db down' })
  })

  it('falls back to a generic message when that failure carries none', async () => {
    forgetHostKeyMock.mockRejectedValue({})

    const res = await call('10.42.0.101')

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'Failed to forget SSH host key' })
  })

  it('lower-cases the host before clearing either store', async () => {
    const res = await call('PVE-Node1.Lab')

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toMatchObject({ host: 'pve-node1.lab' })
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/ssh/host-keys/pve-node1.lab', { method: 'DELETE' })
    expect(forgetHostKeyMock).toHaveBeenCalledWith('pve-node1.lab')
  })
})
