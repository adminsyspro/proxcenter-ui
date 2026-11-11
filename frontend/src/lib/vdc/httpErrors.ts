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
  // Attachment to a shared EVPN zone (#1334).
  if (msg.startsWith('EVPN zone:')) return mapEvpnZoneError(e)
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
  if (msg.startsWith('Tenant network:') && (msg.includes('already') || msg.includes('is still carried') || msg.includes('cannot change while') || msg.includes('still use'))) {
    return { status: 409, message: msg }
  }
  // A Proxmox refusal while creating the member VNet or rewriting a zone.
  if (/^Failed to (create|update|delete) SDN/.test(msg)) return { status: 502, message: msg }
  if (msg.startsWith('vDC not found')) return { status: 404, message: msg }
  if (msg.startsWith('Tenant network:') || msg.startsWith('Tenant not found')) return { status: 400, message: msg }
  return { status: 500, message: msg }
}

// EVPN zones (#1334): the module prefixes every business message with
// "EVPN zone:", the collision audit with "VNI collision:". A lost race on the
// name, the zone id or the VRF VNI lands as P2002 with no message.
export function mapEvpnZoneError(e: any): { status: number; message: string } {
  const msg = e?.message || String(e)
  if (e?.code === 'P2002') {
    return { status: 409, message: 'An EVPN zone with this name, Proxmox zone id or VRF VNI already exists.' }
  }
  if (msg.startsWith('EVPN zone: not found') || msg.startsWith('VNI collision: network not found')) {
    return { status: 404, message: msg }
  }
  if (msg.startsWith('EVPN zone:') && (msg.includes('already') || msg.includes('still holds') || msg.includes('overlaps') || msg.includes('differs') || msg.includes('still carries') || msg.includes('still attached'))) {
    return { status: 409, message: msg }
  }
  // A Proxmox refusal while staging a controller, a zone or a VNet.
  if (/^Failed to (create|update|delete) SDN/.test(msg)) return { status: 502, message: msg }
  if (msg.startsWith('EVPN zone:') || msg.startsWith('VNI collision:')) return { status: 400, message: msg }
  // The VNI picker of a renumbering answers with its own status.
  if (e?.name === 'VniError' && typeof e?.status === 'number') return { status: e.status, message: msg }
  return { status: 500, message: msg }
}
