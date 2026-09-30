import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pveFetch } from '../proxmox/client'
import { setNodeIps, incrementFailures } from '../cache/nodeIpCache'
import { POST as consolePost, consumeConsoleSession } from '@/app/api/v1/connections/[id]/guests/[type]/[node]/[vmid]/console/route'
import { POST as terminalPost, consumeTerminalSession } from '@/app/api/v1/connections/[id]/nodes/[node]/terminal/route'

const state = vi.hoisted(() => ({ conn: {} as any, denied: null as Response | null }))
vi.mock('../connections/getConnection', () => ({ getConnectionById: async () => state.conn, invalidateConnectionCache: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ checkPermission: async () => state.denied, buildVmResourceId: () => 'vm', PERMISSIONS: { VM_CONSOLE: 'vm.console', NODE_CONSOLE: 'node.console' } }))
let server: Server
let seq = 0
async function setup(fallback: boolean) {
  state.denied = null
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: { ticket: 'synthetic-ticket', port: 5900, user: 'test@pam', upid: 'UPID:test' } }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  state.conn = { id: `console-endpoint-${++seq}`, baseUrl: `http://${fallback ? '127.0.0.2' : '127.0.0.1'}:${port}`, apiToken: 'synthetic-token', insecureDev: false }
  if (fallback) {
    setNodeIps(state.conn.id, ['127.0.0.2', '127.0.0.1'], port, 'http')
    incrementFailures(state.conn.id)
    await pveFetch(state.conn, '/version')
  }
  return { endpoint: `http://127.0.0.1:${port}`, port }
}
afterEach(async () => {
  state.denied = null
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
describe.each([false, true])('console endpoint, failover=%s', fallback => {
  it('binds the VNC session to the ticket response endpoint', async () => {
    const { endpoint } = await setup(fallback)
    const configured = state.conn.baseUrl
    const response = await consolePost(new Request('http://localhost'), { params: Promise.resolve({ id: state.conn.id, type: 'qemu', node: 'pve2', vmid: '100' }) })
    const json = await response.json()
    expect(json.data.apiToken).toBeUndefined()
    expect(consumeConsoleSession(json.data.sessionId)).toMatchObject({ baseUrl: endpoint, node: 'pve2', ticket: 'synthetic-ticket', insecure: false })
    expect(state.conn.baseUrl).toBe(configured)
  })
  it('binds the terminal host and port to the ticket response endpoint', async () => {
    const { endpoint, port } = await setup(fallback)
    const response = await terminalPost(new Request('http://localhost'), { params: Promise.resolve({ id: state.conn.id, node: 'pve2' }) })
    const json = await response.json()
    expect(json.data.apiToken).toBeUndefined()
    expect(json.data.ticket).toBeUndefined()
    expect(consumeTerminalSession(json.data.sessionId)).toMatchObject({ baseUrl: endpoint, host: '127.0.0.1', pvePort: port, node: 'pve2', ticket: 'synthetic-ticket', insecure: false })
  })
})
