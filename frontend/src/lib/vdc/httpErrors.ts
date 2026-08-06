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
  if (msg.includes('already has a vDC')) return { status: 409, message: msg }
  if (msg.includes('already exists')) return { status: 409, message: msg }
  if (msg.includes('cannot be created on the provider tenant') || msg.startsWith('Tenant not found')) {
    return { status: 400, message: msg }
  }

  return { status: 500, message: msg }
}
