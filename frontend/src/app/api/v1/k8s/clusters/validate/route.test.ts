import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireK8sPermissionMock = vi.fn()
const resolveStrictTenantMock = vi.fn()
const checkConnectivityMock = vi.fn()

vi.mock('@/lib/k8s/requireK8sPermission', () => ({ requireK8sPermission: (...a: any[]) => requireK8sPermissionMock(...a) }))
vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { K8S_MANAGE: 'k8s.manage' } }))
vi.mock('@/lib/k8s/strictTenant', () => ({ resolveStrictTenant: (...a: any[]) => resolveStrictTenantMock(...a) }))
vi.mock('@/lib/k8s/orchestrator', () => ({ checkConnectivity: (...a: any[]) => checkConnectivityMock(...a) }))

const tokenKubeconfig = `apiVersion: v1\nkind: Config\ncurrent-context: ctx\nclusters:\n- name: c1\n  cluster:\n    server: https://10.0.0.1:6443\ncontexts:\n- name: ctx\n  context: { cluster: c1, user: u1 }\nusers:\n- name: u1\n  user:\n    token: abc`

beforeEach(() => {
  requireK8sPermissionMock.mockReset().mockResolvedValue(null)
  resolveStrictTenantMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1' })
  checkConnectivityMock.mockReset().mockResolvedValue({ ok: true, value: { state: 'healthy', version: 'v1.30.0' } })
})

async function POST() { return (await import('./route')).POST }

describe('POST /api/v1/k8s/clusters/validate', () => {
  it('403 when gate denies', async () => {
    requireK8sPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const res = await callRoute(await POST(), { body: { kubeconfig: tokenKubeconfig } })
    expect(res.status).toBe(403)
  })
  it('403 when tenant invalid', async () => {
    resolveStrictTenantMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) })
    const res = await callRoute(await POST(), { body: { kubeconfig: tokenKubeconfig } })
    expect(res.status).toBe(403)
  })
  it('returns contexts when no context selected', async () => {
    const res = await callRoute(await POST(), { body: { kubeconfig: tokenKubeconfig } })
    expect(res.status).toBe(200)
    const json: any = await readJson(res)
    expect(json.contexts).toEqual(['ctx'])
  })
  it('runs connectivity and never echoes credential', async () => {
    const res = await callRoute(await POST(), { body: { kubeconfig: tokenKubeconfig, context: 'ctx' } })
    const json: any = await readJson(res)
    expect(json.connectivity.state).toBe('healthy')
    expect(JSON.stringify(json)).not.toContain('abc')
    expect(json).not.toHaveProperty('credential')
    expect(json.sanitizedPreview).not.toHaveProperty('credential')
  })
  it('400 with rejections on disallowed auth', async () => {
    const bad = tokenKubeconfig.replace('token: abc', 'exec:\n      command: aws')
    const res = await callRoute(await POST(), { body: { kubeconfig: bad, context: 'ctx' } })
    expect(res.status).toBe(400)
    const json: any = await readJson(res)
    expect(json.rejections.length).toBeGreaterThan(0)
  })
})
