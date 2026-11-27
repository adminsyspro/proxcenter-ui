import { NextResponse } from 'next/server'
import { PERMISSIONS } from '@/lib/rbac'
import { requireK8sPermission } from '@/lib/k8s/requireK8sPermission'
import { resolveStrictTenant } from '@/lib/k8s/strictTenant'
import { sanitizeKubeconfig } from '@/lib/k8s/kubeconfig'
import { listClusters, createCluster } from '@/lib/k8s/repository'
import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'

export async function GET() {
  const denied = await requireK8sPermission(PERMISSIONS.K8S_VIEW)
  if (denied) return denied
  const tenant = await resolveStrictTenant()
  if (!tenant.ok) return tenant.response
  const clusters = await listClusters(tenant.tenantId)
  return NextResponse.json({ clusters }, { status: 200 })
}

async function handlePost(req: Request) {
  const denied = await requireK8sPermission(PERMISSIONS.K8S_MANAGE)
  if (denied) return denied
  const tenant = await resolveStrictTenant()
  if (!tenant.ok) return tenant.response

  const body = await req.json().catch(() => null)
  const name: string = body?.name
  const kubeconfig: string = body?.kubeconfig
  const context: string = body?.context
  if (typeof name !== 'string' || !name || typeof kubeconfig !== 'string' || typeof context !== 'string' || !context) {
    return NextResponse.json({ error: 'name, kubeconfig, context required' }, { status: 400 })
  }

  const san = sanitizeKubeconfig(kubeconfig, context, { allowInsecure: !!body.allowInsecure })
  if (!san.ok) {
    await audit({ action: 'create', category: 'k8s', resourceType: 'kubernetesCluster', resourceName: name, status: 'failure' })
    return NextResponse.json({ rejections: san.rejections, error: san.error }, { status: 400 })
  }

  const distro = body.distro === 'k3s' || body.distro === 'kubeadm' ? body.distro : 'generic'
  const id = await createCluster(tenant.tenantId, {
    name,
    distro,
    source: 'imported',
    cred: san.value!,
    proxmoxConnectionId: body.proxmoxConnectionId ?? null,
  })
  await audit({ action: 'create', category: 'k8s', resourceType: 'kubernetesCluster', resourceId: id, resourceName: name, status: 'success' })
  return NextResponse.json({ id }, { status: 201 })
}

export const POST = withAudit({ category: 'k8s', resourceType: 'kubernetesCluster', resourceNameBodyField: 'name' }, handlePost)
