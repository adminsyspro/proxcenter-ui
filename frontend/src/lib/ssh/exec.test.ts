import { describe, it, expect, vi, beforeEach } from 'vitest'

import { executeSSHDirect, NODE_MGMT_SSH_TIMEOUT_MS } from '@/lib/ssh/exec'

// Captures the connect config the ssh2 Client receives, and drives a
// successful ready -> exec -> close cycle so executeSSHDirect resolves.
const { sshState } = vi.hoisted(() => ({
  sshState: { config: null as any, command: null as any },
}))

vi.mock('ssh2', () => {
  class FakeClient {
    private h: Record<string, (...a: any[]) => void> = {}
    on(ev: string, cb: (...a: any[]) => void) {
      this.h[ev] = cb
      return this
    }
    connect(cfg: any) {
      sshState.config = cfg
      queueMicrotask(() => this.h.ready?.())
    }
    exec(cmd: string, cb: (err: any, stream: any) => void) {
      sshState.command = cmd
      const stream: any = {
        on(ev: string, handler: (...a: any[]) => void) {
          if (ev === 'close') queueMicrotask(() => handler(0))
          return stream
        },
        stderr: { on() {} },
      }
      cb(null, stream)
    }
    end() {}
  }
  return { Client: FakeClient }
})

// Avoid touching the host-key store (DB) in a pure connect-config unit test.
vi.mock('@/lib/ssh/host-key-store', () => ({
  makeHostVerifier: () => () => true,
}))

const base = { host: 'h', port: 22, user: 'root', password: 'pw', command: 'hostname' }

beforeEach(() => {
  sshState.config = null
  sshState.command = null
})

describe('executeSSHDirect readyTimeout (#370)', () => {
  it('exports a 120s node-management budget', () => {
    expect(NODE_MGMT_SSH_TIMEOUT_MS).toBe(120_000)
  })

  it('defaults the connect (readyTimeout) to 30s when no timeoutMs is given', async () => {
    const r = await executeSSHDirect({ ...base })
    expect(r.success).toBe(true)
    expect(sshState.config.readyTimeout).toBe(30_000)
  })

  it('honors a larger timeoutMs on the connect step (the bug: it was hardcoded 30s)', async () => {
    const r = await executeSSHDirect({ ...base, timeoutMs: NODE_MGMT_SSH_TIMEOUT_MS })
    expect(r.success).toBe(true)
    expect(sshState.config.readyTimeout).toBe(120_000)
  })

  it('caps the connect budget at 120s for very long operations', async () => {
    await executeSSHDirect({ ...base, command: 'dd ...', timeoutMs: 3_600_000 })
    expect(sshState.config.readyTimeout).toBe(120_000)
  })
})
