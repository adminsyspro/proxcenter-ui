export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { PERMISSIONS } from '@/lib/rbac'
import { requireK8sPermission } from '@/lib/k8s/requireK8sPermission'
import { resolveStrictTenant } from '@/lib/k8s/strictTenant'
import { listKubeconfigContexts, sanitizeKubeconfig } from '@/lib/k8s/kubeconfig'
import { checkConnectivity } from '@/lib/k8s/orchestrator'

export async function POST(req: Request) {
  const denied = await requireK8sPermission(PERMISSIONS.K8S_MANAGE)
  if (denied) return denied
  const tenant = await resolveStrictTenant()
  if (!tenant.ok) return tenant.response

  const body = await req.json().catch(() => null)
  const kubeconfig: string = body?.kubeconfig
  if (typeof kubeconfig !== 'string') {
    return NextResponse.json({ error: 'kubeconfig required' }, { status: 400 })
  }

  const ctxList = listKubeconfigContexts(kubeconfig)
  if (!ctxList.ok) return NextResponse.json({ error: ctxList.error }, { status: 400 })
  if (!body?.context) return NextResponse.json({ contexts: ctxList.value }, { status: 200 })

  const san = sanitizeKubeconfig(kubeconfig, body.context, { allowInsecure: !!body.allowInsecure })
  if (!san.ok) return NextResponse.json({ contexts: ctxList.value, rejections: san.rejections, error: san.error }, { status: 400 })

  const conn = await checkConnectivity(san.value!)
  return NextResponse.json({
    contexts: ctxList.value,
    sanitizedPreview: {
      apiServerUrl: san.value!.apiServerUrl,
      credentialType: san.value!.credentialType,
      contextName: san.value!.contextName,
    },
    connectivity: conn.ok ? conn.value : { state: 'unreachable', errorMessage: conn.error },
  }, { status: 200 })
}
