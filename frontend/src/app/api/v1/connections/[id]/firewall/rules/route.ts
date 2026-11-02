import { PERMISSIONS } from "@/lib/rbac"
import { providerPveRead } from "@/lib/connections/providerPveRead"

export const runtime = "nodejs"

// GET - Datacenter firewall rules of the cluster (closed to an IaaS tenant).
export const GET = providerPveRead({
  permission: PERMISSIONS.NODE_VIEW,
  on: "connection",
  path: () => "/cluster/firewall/rules",
  shape: "list",
})
