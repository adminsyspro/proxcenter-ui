// GET/DELETE /api/v1/compliance/login-lockouts
// Accounts and client IPs currently locked by the login policy, and the
// admin unlock (DELETE ?kind=account|ip&key=...).
import { NextResponse } from 'next/server'

import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { demoResponse } from '@/lib/demo/demo-api'
import { listActiveLocks, unlockLogin, type LockoutKind } from '@/lib/auth/loginLockout'
import { audit } from '@/lib/audit'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    return NextResponse.json({ data: await listActiveLocks() })
  } catch (e: any) {
    console.error('Error listing login lockouts:', e)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const params = new URL(req.url).searchParams
    const kind = params.get('kind')
    const key = params.get('key')
    if ((kind !== 'account' && kind !== 'ip') || !key) {
      return NextResponse.json({ error: 'kind (account|ip) and key are required' }, { status: 400 })
    }

    const removed = await unlockLogin(kind as LockoutKind, key)
    if (!removed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await audit({
      action: 'login_unlocked',
      category: 'security',
      resourceType: kind === 'account' ? 'login_account' : 'login_ip',
      resourceId: key,
      resourceName: key,
      details: { kind, key },
    })

    return NextResponse.json({ data: { kind, key } })
  } catch (e: any) {
    console.error('Error unlocking login:', e)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
