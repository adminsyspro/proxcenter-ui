import { describe, it, expect, vi, beforeEach } from 'vitest'

const executeSSHMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/ssh/exec', () => ({ executeSSH: executeSSHMock }))

beforeEach(() => executeSSHMock.mockReset())

const conn = { baseUrl: 'https://203.0.113.10:8006' }

describe('verifyNodeTarget', () => {
  it('passes without probing when the target is NOT the connection host (direct IP)', async () => {
    const { verifyNodeTarget } = await import('./verify-node-target')
    const r = await verifyNodeTarget('c1', conn, 'pve1', '10.0.0.5')
    expect(r).toEqual({ ok: true })
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('passes when target is the connection host and remote hostname matches', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: true, output: 'pve1\n' })
    const { verifyNodeTarget } = await import('./verify-node-target')
    const r = await verifyNodeTarget('c1', conn, 'pve1', '203.0.113.10')
    expect(r).toEqual({ ok: true })
    expect(executeSSHMock).toHaveBeenCalledWith('c1', '203.0.113.10', 'hostname -s')
  })

  it('matches on the short label when node is an FQDN', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: true, output: 'pve1' })
    const { verifyNodeTarget } = await import('./verify-node-target')
    const r = await verifyNodeTarget('c1', conn, 'pve1.example.com', '203.0.113.10')
    expect(r).toEqual({ ok: true })
  })

  it('refuses (409) when target is the connection host but hostname mismatches', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: true, output: 'bastion' })
    const { verifyNodeTarget } = await import('./verify-node-target')
    const r = await verifyNodeTarget('c1', conn, 'pve1', '203.0.113.10')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(409)
      expect(r.error).toMatch(/bastion/)
    }
  })

  it('returns 502 with an actionable error when the probe fails', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: false, error: 'timeout' })
    const { verifyNodeTarget } = await import('./verify-node-target')
    const r = await verifyNodeTarget('c1', conn, 'pve1', '203.0.113.10')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(502)
  })

  it('refuses (409) when the remote hostname is empty (identity unverifiable)', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: true, output: '   ' })
    const { verifyNodeTarget } = await import('./verify-node-target')
    const r = await verifyNodeTarget('c1', conn, 'pve1', '203.0.113.10')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(409)
      expect(r.error).toMatch(/identity cannot be confirmed/)
    }
  })

  it('matches case-insensitively', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: true, output: 'PVE1' })
    const { verifyNodeTarget } = await import('./verify-node-target')
    const r = await verifyNodeTarget('c1', conn, 'pve1', '203.0.113.10')
    expect(r).toEqual({ ok: true })
  })

  it('matches when the remote reports an FQDN but the node is short', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: true, output: 'pve1.example.com' })
    const { verifyNodeTarget } = await import('./verify-node-target')
    const r = await verifyNodeTarget('c1', conn, 'pve1', '203.0.113.10')
    expect(r).toEqual({ ok: true })
  })
})

describe('sshTargetError', () => {
  it('gives an actionable hint for a private target', async () => {
    const { sshTargetError } = await import('./verify-node-target')
    expect(sshTargetError('pve1', '10.0.0.5')).toMatch(/private address/)
  })
  it('uses the fallback for a public target', async () => {
    const { sshTargetError } = await import('./verify-node-target')
    expect(sshTargetError('pve1', '203.0.113.10', 'Failed to start upgrade')).toBe('Failed to start upgrade')
  })
  it('has a generic default when no fallback is given for a public target', async () => {
    const { sshTargetError } = await import('./verify-node-target')
    expect(sshTargetError('pve1', '203.0.113.10')).toMatch(/pve1/)
  })
})
