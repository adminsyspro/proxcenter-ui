import { PERMISSIONS } from "@/lib/rbac"
import { providerPveRead } from "@/lib/connections/providerPveRead"

export const runtime = "nodejs"

// GET - PCI devices of a node (closed to an IaaS tenant).
export const GET = providerPveRead({
  permission: PERMISSIONS.NODE_VIEW,
  on: "node",
  path: ({ node }) => `/nodes/${encodeURIComponent(String(node))}/hardware/pci`,
  shape: "list",
})
