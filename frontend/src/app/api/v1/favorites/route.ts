import { randomUUID } from 'crypto'

import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { prisma } from '@/lib/db/prisma'
import { authOptions } from '@/lib/auth'
import { getCurrentTenantId } from '@/lib/tenant'

export const runtime = 'nodejs'

// GET /api/v1/favorites - Récupérer tous les favoris de l'utilisateur
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.email || 'anonymous'
    const tenantId = await getCurrentTenantId()

    const rows = await prisma.favorite.findMany({
      where: { userId, tenantId },
      orderBy: { createdAt: 'desc' },
    })

    // Preserve the snake_case wire shape consumed by the existing UI.
    const favorites = rows.map(r => ({
      id: r.id,
      tenant_id: r.tenantId,
      user_id: r.userId,
      vm_key: r.vmKey,
      connection_id: r.connectionId,
      node: r.node,
      vm_type: r.vmType,
      vmid: r.vmid,
      vm_name: r.vmName,
      created_at: r.createdAt.toISOString(),
    }))

    return NextResponse.json({
      data: favorites,
      count: favorites.length,
    })
  } catch (error: any) {
    console.error('Error fetching favorites:', error)

return NextResponse.json(
      { error: error?.message || 'Server error' },
      { status: 500 }
    )
  }
}

// POST /api/v1/favorites - Ajouter un favori
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.email || 'anonymous'
    const tenantId = await getCurrentTenantId()

    const body = await req.json()
    const { connectionId, node, vmType, vmid, vmName } = body

    if (!connectionId || !node || !vmType || !vmid) {
      return NextResponse.json(
        { error: 'connectionId, node, vmType and vmid are required' },
        { status: 400 }
      )
    }

    // Clé unique pour la VM
    const vmKey = `${connectionId}:${node}:${vmType}:${vmid}`

    // Already starred in THIS tenant? The same key may be starred in another
    // tenant: favorites are unique per (tenant, user, vm key).
    const existing = await prisma.favorite.findUnique({
      where: { tenantId_userId_vmKey: { tenantId, userId, vmKey } },
      select: { id: true },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'This VM is already in your favorites' },
        { status: 409 }
      )
    }

    const id = randomUUID()
    const now = new Date()

    await prisma.favorite.create({
      data: {
        id,
        tenantId,
        userId,
        vmKey,
        connectionId,
        node,
        vmType,
        vmid: String(vmid),
        vmName: vmName || null,
        createdAt: now,
      },
    })

    return NextResponse.json({
      success: true,
      data: { id, vmKey },
      message: 'Favorite added',
    })
  } catch (error: any) {
    // A concurrent POST for the same key won the insert: same answer as the
    // lookup above rather than a 500.
    if (error?.code === 'P2002') {
      return NextResponse.json(
        { error: 'This VM is already in your favorites' },
        { status: 409 }
      )
    }

    console.error('Error adding favorite:', error)

return NextResponse.json(
      { error: error?.message || 'Server error' },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/favorites - Supprimer un favori
export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.email || 'anonymous'
    const tenantId = await getCurrentTenantId()

    const { searchParams } = new URL(req.url)
    const vmKey = searchParams.get('vmKey')

    if (!vmKey) {
      return NextResponse.json(
        { error: 'vmKey is required' },
        { status: 400 }
      )
    }

    const result = await prisma.favorite.deleteMany({
      where: { userId, vmKey, tenantId },
    })

    if (result.count === 0) {
      return NextResponse.json(
        { error: 'Favorite not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Favorite removed',
    })
  } catch (error: any) {
    console.error('Error deleting favorite:', error)

return NextResponse.json(
      { error: error?.message || 'Server error' },
      { status: 500 }
    )
  }
}
