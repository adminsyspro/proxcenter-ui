import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db/prisma'
import { getCurrentTenantId } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { METRIC_TYPES, OPERATORS, SEVERITIES } from '../route'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

// GET - Détails d'une règle
export async function GET(req: Request, { params }: Params) {
  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_VIEW)

    if (denied) return denied

    const { id } = await params
    const tenantId = await getCurrentTenantId()

    const rule = await prisma.alertRule.findFirst({ where: { id, tenantId } })

    if (!rule) {
      return NextResponse.json({ error: 'Règle non trouvée' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        id: rule.id,
        name: rule.name,
        description: rule.description,
        enabled: rule.enabled,
        metric: rule.metric,
        operator: rule.operator,
        threshold: rule.threshold,
        duration: rule.duration,
        severity: rule.severity,
        scopeType: rule.scopeType,
        scopeTarget: rule.scopeTarget,
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
      },
    })
  } catch (error: any) {
    console.error('Erreur GET alert-rules/[id]:', error)

return NextResponse.json(
      { error: error?.message || 'Erreur serveur' },
      { status: 500 }
    )
  }
}

// PUT - Modifier une règle
export async function PUT(req: Request, { params }: Params) {
  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_MANAGE)

    if (denied) return denied

    const { id } = await params
    const body = await req.json()
    const { name, description, enabled, metric, operator, threshold, duration, severity, scopeType, scopeTarget } = body

    const tenantId = await getCurrentTenantId()

    // Vérifier que la règle existe et appartient au tenant
    const existing = await prisma.alertRule.findFirst({ where: { id, tenantId }, select: { id: true } })

    if (!existing) {
      return NextResponse.json({ error: 'Règle non trouvée' }, { status: 404 })
    }

    // Validation
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Le nom est requis' }, { status: 400 })
    }

    if (!metric || !METRIC_TYPES[metric as keyof typeof METRIC_TYPES]) {
      return NextResponse.json({ error: 'Métrique invalide' }, { status: 400 })
    }

    if (!operator || !OPERATORS[operator as keyof typeof OPERATORS]) {
      return NextResponse.json({ error: 'Opérateur invalide' }, { status: 400 })
    }

    if (threshold === undefined || threshold === null || Number.isNaN(Number(threshold))) {
      return NextResponse.json({ error: 'Seuil invalide' }, { status: 400 })
    }

    if (!severity || !SEVERITIES.includes(severity)) {
      return NextResponse.json({ error: 'Sévérité invalide' }, { status: 400 })
    }

    await prisma.alertRule.update({
      where: { id },
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        enabled: enabled !== false,
        metric,
        operator,
        threshold: Number(threshold),
        duration: Number(duration) || 0,
        severity,
        scopeType: scopeType || 'all',
        scopeTarget: scopeTarget?.trim() || null,
        updatedAt: new Date(),
      },
    })

    return NextResponse.json({ message: 'Règle mise à jour' })
  } catch (error: any) {
    console.error('Erreur PUT alert-rules/[id]:', error)

return NextResponse.json(
      { error: error?.message || 'Erreur serveur' },
      { status: 500 }
    )
  }
}

// PATCH - Activer/désactiver une règle
export async function PATCH(req: Request, { params }: Params) {
  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_MANAGE)

    if (denied) return denied

    const { id } = await params
    const body = await req.json()
    const { enabled } = body

    const tenantId = await getCurrentTenantId()

    const result = await prisma.alertRule.updateMany({
      where: { id, tenantId },
      data: { enabled: !!enabled, updatedAt: new Date() },
    })

    if (result.count === 0) {
      return NextResponse.json({ error: 'Règle non trouvée' }, { status: 404 })
    }

    return NextResponse.json({ message: enabled ? 'Règle activée' : 'Règle désactivée' })
  } catch (error: any) {
    console.error('Erreur PATCH alert-rules/[id]:', error)

return NextResponse.json(
      { error: error?.message || 'Erreur serveur' },
      { status: 500 }
    )
  }
}

// DELETE - Supprimer une règle
export async function DELETE(req: Request, { params }: Params) {
  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_MANAGE)

    if (denied) return denied

    const { id } = await params
    const tenantId = await getCurrentTenantId()

    // Cascade on alert_instances is declared in the Prisma schema, so the
    // alertRule.deleteMany above also drops every dependent instance.
    const result = await prisma.alertRule.deleteMany({ where: { id, tenantId } })

    if (result.count === 0) {
      return NextResponse.json({ error: 'Règle non trouvée' }, { status: 404 })
    }

    return NextResponse.json({ message: 'Règle supprimée' })
  } catch (error: any) {
    console.error('Erreur DELETE alert-rules/[id]:', error)

return NextResponse.json(
      { error: error?.message || 'Erreur serveur' },
      { status: 500 }
    )
  }
}
