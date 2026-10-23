// GET/DELETE /api/v1/compliance/login-lockouts
// Accounts and client IPs currently locked by the login policy, accounts whose
// second factor is throttled, and the admin unlock
// (DELETE ?kind=account|ip|totp&key=...; a totp key is the user id).
import { NextResponse } from 'next/server'

import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { demoResponse } from '@/lib/demo/demo-api'
import { listActiveLocks, unlockLogin, type ActiveLockKind } from '@/lib/auth/loginLockout'
import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'

const LOCK_KINDS: Record<ActiveLockKind, string> = {
  account: 'login_account',
  ip: 'login_ip',
  totp: 'login_totp',
}

function isLockKind(kind: string | null): kind is ActiveLockKind {
  return kind !== null && Object.hasOwn(LOCK_KINDS, kind)
}

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

async function handleDelete(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const params = new URL(req.url).searchParams
    const kind = params.get('kind')
    const key = params.get('key')
    if (!isLockKind(kind) || !key) {
      return NextResponse.json({ error: 'kind (account|ip|totp) and key are required' }, { status: 400 })
    }

    const removed = await unlockLogin(kind, key)
    if (!removed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await audit({
      action: 'login_unlocked',
      category: 'security',
      resourceType: LOCK_KINDS[kind],
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

export const DELETE = withAudit({ category: 'security', resourceType: 'login_lockout' }, handleDelete)
