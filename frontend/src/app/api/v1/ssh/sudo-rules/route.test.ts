/**
 * GET /api/v1/ssh/sudo-rules: the rules of the restricted sudoers template,
 * for whoever may view connections.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkPermissionMock, loadSudoRulesMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  loadSudoRulesMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { CONNECTION_VIEW: 'connection.view' } }))
vi.mock('@/lib/ssh/loadSudoRules', () => ({ loadSudoRules: loadSudoRulesMock }))

import { GET } from './route'

describe('GET /api/v1/ssh/sudo-rules', () => {
  beforeEach(() => {
    checkPermissionMock.mockReset().mockResolvedValue(null)
    loadSudoRulesMock.mockReset().mockResolvedValue({ rules: [{ id: 'a' }], orchestratorAvailable: true, sflowCollector: '10.42.0.250:6343' })
  })

  it('returns the loaded rules to a viewer of connections', async () => {
    const res = await GET()

    expect(checkPermissionMock).toHaveBeenCalledWith('connection.view')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rules: [{ id: 'a' }], orchestratorAvailable: true, sflowCollector: '10.42.0.250:6343' })
  })

  it('answers the denial and loads nothing without the permission', async () => {
    checkPermissionMock.mockResolvedValue(new Response('forbidden', { status: 403 }))
    const res = await GET()

    expect(res.status).toBe(403)
    expect(loadSudoRulesMock).not.toHaveBeenCalled()
  })
})
