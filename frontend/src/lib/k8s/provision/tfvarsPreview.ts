// src/lib/k8s/provision/tfvarsPreview.ts
// Renders a stable, human-readable preview of the request for the wizard's
// review step. This is pretty JSON, not real HCL/tfvars: the orchestrator
// (not the frontend) turns the request into OpenTofu variables server-side.

import type { ProvisionRequest } from '@/lib/k8s/provisionOrchestrator'

export function tfvarsPreview(req: ProvisionRequest): string {
  return JSON.stringify(req, null, 2)
}
