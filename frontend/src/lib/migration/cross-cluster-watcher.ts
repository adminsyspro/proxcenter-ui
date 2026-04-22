import { pveFetch } from '@/lib/proxmox/client'
import { decryptSecret } from '@/lib/crypto/secret'
import { getTenantPrisma } from '@/lib/tenant'
import { getNodeIp } from '@/lib/ssh/node-ip'
import { executeSSHDirect, shellEscape, type SSHResult } from '@/lib/ssh/exec'
import type { PveConn } from '@/lib/connections/getConnection'

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://proxcenter-orchestrator:8080'

const POLL_INTERVAL_MS = 2_000
const MAX_POLL_ATTEMPTS = 10_800 // ~6h, enough for multi-TB cross-cluster transfers

type WatcherOpts = {
  connectionId: string
  tenantId: string
  sourceConn: PveConn
  sourceNode: string
  vmid: string
  upid: string
  deleteSource: boolean
}

/**
 * SSH runner that does not rely on the HTTP request session context.
 * The high-level executeSSH() in @/lib/ssh/exec reads credentials via
 * getSessionPrisma(), which depends on cookies — those are gone once the
 * POST /remote-migrate response has returned and this watcher is running
 * detached. We resolve SSH creds using the tenantId captured at request
 * time, then reuse orchestrator-first + ssh2-direct fallback.
 */
async function runSshForWatcher(
  connectionId: string,
  tenantId: string,
  nodeIp: string,
  command: string,
  timeoutMs = 30_000,
): Promise<SSHResult> {
  const prisma = getTenantPrisma(tenantId)
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: {
      sshEnabled: true,
      sshPort: true,
      sshUser: true,
      sshAuthMethod: true,
      sshKeyEnc: true,
      sshPassEnc: true,
      sshUseSudo: true,
    },
  })

  if (!connection?.sshEnabled) {
    return { success: false, error: 'SSH not enabled for this connection' }
  }

  const port = connection.sshPort || 22
  const user = connection.sshUser || 'root'

  let key: string | undefined
  let password: string | undefined
  let passphrase: string | undefined
  const authMethod = connection.sshAuthMethod || (connection.sshKeyEnc ? 'key' : 'password')

  if (authMethod === 'key' && connection.sshKeyEnc) {
    try { key = decryptSecret(connection.sshKeyEnc) } catch { /* decrypt failure falls through */ }
  } else if (authMethod === 'password' && connection.sshPassEnc) {
    try { password = decryptSecret(connection.sshPassEnc) } catch { /* decrypt failure falls through */ }
  } else {
    if (connection.sshKeyEnc) { try { key = decryptSecret(connection.sshKeyEnc) } catch { /* ignore */ } }
    if (connection.sshPassEnc) {
      try {
        const decrypted = decryptSecret(connection.sshPassEnc)
        if (key) passphrase = decrypted
        else password = decrypted
      } catch { /* ignore */ }
    }
  }

  const finalCommand = connection.sshUseSudo ? `sudo sh -c ${shellEscape(command)}` : command

  try {
    const body: Record<string, unknown> = { host: nodeIp, port, user, command: finalCommand }
    if (key) body.key = key
    if (password) body.password = password
    if (passphrase) body.passphrase = passphrase

    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/ssh/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (res.ok) {
      const data = await res.json()
      return { success: data.success !== false, output: data.output, error: data.error }
    }
  } catch {
    // orchestrator unreachable, fall through to direct ssh2
  }

  return executeSSHDirect({ host: nodeIp, port, user, key, password, passphrase, command: finalCommand, timeoutMs })
}

/**
 * Watch a cross-cluster migration task to completion and run post-migration
 * cleanup (SSH unlock + optional source VM delete).
 *
 * Runs fully server-side so the cleanup is guaranteed even if the user
 * closes the browser tab, navigates away, or the tab is throttled in the
 * background. The POST /remote-migrate handler fires this as a detached
 * promise right after kicking off the PVE migration.
 *
 * Idempotent with the UI-polling cleanup that still runs inside
 * GET /tasks/[upid]/route.ts: qm unlock is a no-op when the VM is already
 * unlocked, and DELETE responds 404 when the VM is already gone.
 */
export async function watchMigrationAndCleanup(opts: WatcherOpts): Promise<void> {
  const { connectionId, tenantId, sourceConn, sourceNode, vmid, upid, deleteSource } = opts
  const tag = `[migrate-watcher:${vmid}]`

  console.log(`${tag} started (deleteSource=${deleteSource}, upid=${upid})`)

  let taskStatus: any = null
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    try {
      taskStatus = await pveFetch<any>(
        sourceConn,
        `/nodes/${encodeURIComponent(sourceNode)}/tasks/${encodeURIComponent(upid)}/status`,
      )
      if (taskStatus?.status === 'stopped') break
    } catch (e: any) {
      // Transient PVE / network errors — keep polling. Log every ~60s.
      if (i % 30 === 0) console.warn(`${tag} status poll transient error:`, e?.message)
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  if (taskStatus?.status !== 'stopped') {
    console.warn(`${tag} timed out waiting for migration task to finish`)
    return
  }

  const exitstatus = String(taskStatus?.exitstatus || '')
  let shouldCleanup = exitstatus === 'OK'

  // "migration problems" / "migration finished with problems" still warrant
  // cleanup when the data + state transfer actually completed (the error
  // comes from the post-transfer nbdstop/resume phase).
  if (!shouldCleanup && (exitstatus.includes('migration problems') || exitstatus.includes('migration finished with problems'))) {
    try {
      const logs = await pveFetch<any[]>(
        sourceConn,
        `/nodes/${encodeURIComponent(sourceNode)}/tasks/${encodeURIComponent(upid)}/log?limit=5000`,
      )
      const logText = (logs || []).map((l: any) => l?.t || '').join('\n')
      shouldCleanup = logText.includes('migration status: completed') || logText.includes('migration completed')
    } catch { /* couldn't fetch logs, keep shouldCleanup = false */ }
  }

  if (!shouldCleanup) {
    console.log(`${tag} migration ended with exit=${exitstatus || 'unknown'}, skipping cleanup`)
    return
  }

  let unlocked = false
  try {
    const vmConfig = await pveFetch<any>(
      sourceConn,
      `/nodes/${encodeURIComponent(sourceNode)}/qemu/${encodeURIComponent(vmid)}/config`,
    )
    if (vmConfig?.lock) {
      const nodeIp = await getNodeIp(sourceConn, sourceNode)
      const result = await runSshForWatcher(connectionId, tenantId, nodeIp, `qm unlock ${vmid}`)
      if (result.success) {
        console.log(`${tag} auto-unlocked VM on ${sourceNode}`)
        unlocked = true
      } else {
        console.warn(`${tag} SSH unlock failed: ${result.error}`)
      }
    } else {
      unlocked = true
    }
  } catch (e: any) {
    const msg = String(e?.message || '')
    if (msg.includes('404')) {
      console.log(`${tag} source VM already gone, nothing to clean up`)
      return
    }
    console.warn(`${tag} could not read source VM config:`, msg)
  }

  if (deleteSource && unlocked) {
    try {
      await pveFetch(
        sourceConn,
        `/nodes/${encodeURIComponent(sourceNode)}/qemu/${encodeURIComponent(vmid)}?purge=1&destroy-unreferenced-disks=1`,
        { method: 'DELETE' },
      )
      console.log(`${tag} deleted source VM on ${sourceNode}`)
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('404')) {
        console.log(`${tag} source VM already gone`)
      } else {
        console.warn(`${tag} could not delete source VM:`, msg)
      }
    }
  } else if (deleteSource && !unlocked) {
    console.warn(`${tag} cannot delete source VM: unlock failed, manual cleanup needed`)
  }
}
