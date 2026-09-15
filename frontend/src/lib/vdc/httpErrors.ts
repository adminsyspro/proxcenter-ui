// src/lib/vdc/httpErrors.ts
// Maps createVdc rejections to HTTP statuses. Business-rule violations are
// 409/400 (client-fixable), everything else stays a 500.

export function mapCreateVdcError(e: any): { status: number; message: string } {
  const msg = e?.message || String(e)

  // Lost race: the DB unique constraints (tenant_id, connection_id) /
  // (tenant_id, slug) reject as Prisma P2002 with no business message.
  if (e?.code === 'P2002') {
    return {
      status: 409,
      message: 'A vDC already exists for this tenant on this cluster (or its slug is already taken).',
    }
  }
  if (msg.includes('Cannot shrink VLAN pools')) return { status: 409, message: msg }
  if (msg.startsWith('VLAN pool')) return { status: 400, message: msg }
  if (msg.includes('already has a vDC')) return { status: 409, message: msg }
  if (msg.includes('already exists')) return { status: 409, message: msg }
  if (msg.includes('cannot be created on the provider tenant') || msg.startsWith('Tenant not found')) {
    return { status: 400, message: msg }
  }
  if (msg.includes('not in the provider pool')) return { status: 400, message: msg }
  // ISO library grants (#894): a storage id that is malformed, absent from
  // the cluster or without `iso` content is a client-fixable 400.
  if (msg.includes('ISO library') || msg.includes('does not hold ISO content')) return { status: 400, message: msg }
  // VXLAN transport (#899): a malformed address, MTU, VLAN or CIDR is a 400;
  // a zone rewrite that Proxmox refused is an upstream failure. A transport
  // another vDC already owns is a conflict, so it is matched first.
  if (msg.startsWith('VXLAN transport') && msg.includes('is in use by vDC')) return { status: 409, message: msg }
  if (msg.startsWith('VXLAN transport')) return { status: 400, message: msg }
  if (msg.startsWith('Failed to update SDN zone')) return { status: 502, message: msg }
  if (msg.includes('is in use by vDC')) return { status: 409, message: msg }
  if (msg.includes('Cannot remove storage policy')) return { status: 409, message: msg }
  if (msg.startsWith('A storage policy with this name or storage')) return { status: 409, message: msg }
  // Checked BEFORE the generic "Storage policy" 400 bucket below: both
  // messages start with the same two words, and this one is a conflict
  // (assignments block the storage change) rather than a plain validation
  // failure.
  if (msg.includes('cannot be changed while assigned')) return { status: 409, message: msg }
  if (msg.startsWith('Storage policy')) return { status: 400, message: msg }

  return { status: 500, message: msg }
}

// Tenant networks (#901): the module prefixes every business message with
// "Tenant network:"; a lost race on (tenant_id, name) or on the VNI lands as
// P2002 with no message.
export function mapTenantNetworkError(e: any): { status: number; message: string } {
  const msg = e?.message || String(e)
  if (e?.code === 'P2002') {
    return { status: 409, message: 'A tenant network with this name or VNI already exists.' }
  }
  if (msg.startsWith('Tenant network: not found')) return { status: 404, message: msg }
  if (msg.startsWith('Tenant network:') && (msg.includes('already') || msg.includes('is still carried') || msg.includes('cannot change while'))) {
    return { status: 409, message: msg }
  }
  if (msg.startsWith('Tenant network:') || msg.startsWith('Tenant not found')) return { status: 400, message: msg }
  return { status: 500, message: msg }
}
