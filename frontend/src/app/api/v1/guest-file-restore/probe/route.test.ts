import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { userGuardMock, targetGuardMock, settingsMock, connMock, probeAgentMock, probeSshMock, hostGuardMock } = vi.hoisted(() => ({
  userGuardMock: vi.fn(),
  targetGuardMock: vi.fn(),
  settingsMock: vi.fn(),
  connMock: vi.fn(),
  probeAgentMock: vi.fn(),
  probeSshMock: vi.fn(),
  hostGuardMock: vi.fn(),
}))

vi.mock('@/lib/guestFileRestore/guard', () => ({
  requireGuestFileRestoreUser: () => userGuardMock(),
  authorizeRestoreTarget: (...a: any[]) => targetGuardMock(...a),
}))
vi.mock('@/lib/guestFileRestore/settings', () => ({ loadGuestFileRestoreSettings: () => settingsMock() }))
vi.mock('@/lib/guestFileRestore/guestAddresses', () => ({ assertSshHostAllowed: (...a: any[]) => hostGuardMock(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionByIdOrNull: (...a: any[]) => connMock(...a) }))
vi.mock('@/lib/guestFileRestore/writers/agent', () => ({ probeAgent: (...a: any[]) => probeAgentMock(...a) }))
vi.mock('@/lib/guestFileRestore/writers/ssh', () => ({ probeSsh: (...a: any[]) => probeSshMock(...a) }))

import { POST } from './route'

const target = { connId: 'c1', node: 'pve1', type: 'qemu', vmid: 100 }
const settings = { agentEnabled: true, sshEnabled: true, sshConnectTimeoutSec: 20 }

beforeEach(() => {
  userGuardMock.mockReset().mockResolvedValue({ denied: null, principal: { kind: 'session', userId: 'u1', tenantId: 'default' } })
  targetGuardMock.mockReset().mockResolvedValue(null)
  settingsMock.mockReset().mockResolvedValue({ ...settings })
  connMock.mockReset().mockResolvedValue({ id: 'c1', baseUrl: 'https://pve:8006', apiToken: 't' })
  probeAgentMock.mockReset().mockResolvedValue({ ok: true, os: 'linux', hostname: 'web-01' })
  probeSshMock.mockReset().mockResolvedValue({ ok: true, os: 'windows', hostname: 'WIN', hostKeyFingerprint: 'SHA256:abc', details: { fingerprint: 'SHA256:abc' } })
  hostGuardMock.mockReset().mockResolvedValue(null)
})

describe('POST /api/v1/guest-file-restore/probe', () => {
  it('refuses an unlicensed or anonymous caller before reading the body', async () => {
    userGuardMock.mockResolvedValue({ denied: new Response(null, { status: 403 }) })
    const res = await callRoute(POST, { body: { target, method: 'agent' } })
    expect(res.status).toBe(403)
    expect(targetGuardMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid body with the issues', async () => {
    const res = await callRoute(POST, { body: { target: { ...target, vmid: 'abc' }, method: 'agent' } })
    expect(res.status).toBe(400)
    expect(((await readJson(res)) as any).issues[0].path).toBe('target.vmid')
  })

  it('checks BACKUP_RESTORE on the target vm', async () => {
    targetGuardMock.mockResolvedValue(new Response(null, { status: 403 }))
    const res = await callRoute(POST, { body: { target, method: 'agent' } })
    expect(res.status).toBe(403)
    expect(targetGuardMock).toHaveBeenCalledWith(target)
    expect(probeAgentMock).not.toHaveBeenCalled()
  })

  it('probes the guest agent and relays the verdict', async () => {
    const res = await callRoute(POST, { body: { target, method: 'agent' } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ ok: true, os: 'linux', hostname: 'web-01' })
    expect(probeAgentMock).toHaveBeenCalledWith({ conn: expect.objectContaining({ id: 'c1' }), node: 'pve1', vmid: 100 })
  })

  it('refuses the agent method on a container and when disabled', async () => {
    let res = await callRoute(POST, { body: { target: { ...target, type: 'lxc' }, method: 'agent' } })
    expect(res.status).toBe(400)
    settingsMock.mockResolvedValue({ ...settings, agentEnabled: false })
    res = await callRoute(POST, { body: { target, method: 'agent' } })
    expect(res.status).toBe(403)
  })

  it('probes over SSH with the settings timeout, reports the host key fingerprint and requires credentials', async () => {
    const ssh = { host: '10.0.0.5', username: 'Administrator', password: 'p' }
    const lxc = { ...target, type: 'lxc' }
    const res = await callRoute(POST, { body: { target: lxc, method: 'ssh', ssh } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toMatchObject({ ok: true, os: 'windows', hostKeyFingerprint: 'SHA256:abc' })
    expect(probeSshMock).toHaveBeenCalledWith(ssh, 20_000)
    expect(hostGuardMock).toHaveBeenCalledWith({ conn: expect.objectContaining({ id: 'c1' }), target: lxc, host: '10.0.0.5', principal: expect.objectContaining({ userId: 'u1' }) })

    const missing = await callRoute(POST, { body: { target, method: 'ssh' } })
    expect(missing.status).toBe(400)
    settingsMock.mockResolvedValue({ ...settings, sshEnabled: false })
    expect((await callRoute(POST, { body: { target, method: 'ssh', ssh } })).status).toBe(403)
  })

  it('refuses an SSH host that is not one of the guest addresses, before any connection attempt', async () => {
    hostGuardMock.mockResolvedValue(new Response(JSON.stringify({ error: "SSH host must be one of the guest's addresses" }), { status: 400 }))
    const res = await callRoute(POST, { body: { target, method: 'ssh', ssh: { host: '10.9.9.9', username: 'root', password: 'p' } } })
    expect(res.status).toBe(400)
    expect(probeSshMock).not.toHaveBeenCalled()
  })

  it('relays a generic SSH failure class without raw socket text', async () => {
    probeSshMock.mockResolvedValue({ ok: false, error: 'SSH authentication failed: check the user name, password or private key', errorClass: 'auth_failed' })
    const res = await callRoute(POST, { body: { target, method: 'ssh', ssh: { host: '10.0.0.5', username: 'root', password: 'p' } } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ ok: false, error: 'SSH authentication failed: check the user name, password or private key', errorClass: 'auth_failed' })
  })

  it('answers 404 when the target connection is unknown', async () => {
    connMock.mockResolvedValue(null)
    expect((await callRoute(POST, { body: { target, method: 'agent' } })).status).toBe(404)
  })
})
