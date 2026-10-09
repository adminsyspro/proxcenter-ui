// src/app/api/v1/guest-file-restore/probe/route.ts
//
// "Test connection" of the restore dialog: reaches the guest the way the job
// would (guest agent or SSH) and reports its OS, plus the SSH host key
// fingerprint the operator confirms before creating the job. Always answers
// 200 with `{ ok, ... }` once the request itself is accepted; credentials
// are used for this one connection and dropped. The SSH host must be one of
// the guest's own addresses (super admins excepted).

import { NextResponse } from 'next/server'

import { getConnectionByIdOrNull } from '@/lib/connections/getConnection'
import { authorizeRestoreTarget, requireGuestFileRestoreUser } from '@/lib/guestFileRestore/guard'
import { assertSshHostAllowed } from '@/lib/guestFileRestore/guestAddresses'
import { probeRequestSchema, validationError } from '@/lib/guestFileRestore/schemas'
import { loadGuestFileRestoreSettings } from '@/lib/guestFileRestore/settings'
import type { GuestFileRestoreProbeResult } from '@/lib/guestFileRestore/types'
import { probeAgent } from '@/lib/guestFileRestore/writers/agent'
import { probeSsh } from '@/lib/guestFileRestore/writers/ssh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await requireGuestFileRestoreUser()
  if (guard.denied) return guard.denied

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = probeRequestSchema.safeParse(body)
  if (!parsed.success) return validationError(parsed.error)
  const { target, method, ssh } = parsed.data

  const denied = await authorizeRestoreTarget(target)
  if (denied) return denied

  try {
    const settings = await loadGuestFileRestoreSettings()
    if (method === 'agent') {
      if (!settings.agentEnabled) {
        return NextResponse.json({ error: 'The guest agent method is disabled in the settings' }, { status: 403 })
      }
      if (target.type !== 'qemu') {
        return NextResponse.json({ error: 'The guest agent method is only available for virtual machines' }, { status: 400 })
      }
    } else if (!settings.sshEnabled) {
      return NextResponse.json({ error: 'The SSH method is disabled in the settings' }, { status: 403 })
    }

    const conn = await getConnectionByIdOrNull(target.connId)
    if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

    let result: GuestFileRestoreProbeResult
    if (method === 'agent') {
      result = await probeAgent({ conn, node: target.node, vmid: target.vmid })
    } else {
      if (!ssh) return NextResponse.json({ error: 'SSH credentials are required' }, { status: 400 })
      const hostDenied = await assertSshHostAllowed({ conn, target, host: ssh.host, principal: guard.principal })
      if (hostDenied) return hostDenied
      result = await probeSsh(ssh, settings.sshConnectTimeoutSec * 1000)
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Erreur POST guest-file-restore/probe:', error)
    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}
