import { requireK8sPermission } from '@/lib/k8s/requireK8sPermission'
import { PERMISSIONS } from '@/lib/rbac'

/** Guard of the routes that deploy, change or destroy cluster VMs: k8s.provision, Enterprise like all of Kubernetes. */
export async function requireK8sProvision(): Promise<Response | null> {
  return requireK8sPermission(PERMISSIONS.K8S_PROVISION)
}
