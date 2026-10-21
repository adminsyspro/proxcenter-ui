import { randomUUID } from 'crypto'

import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db/prisma'
import { getCurrentTenantId } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'

// Types de métriques supportées
export const METRIC_TYPES = {
  'cpu': { label: 'CPU (%)', unit: '%', min: 0, max: 100 },
  'memory': { label: 'RAM (%)', unit: '%', min: 0, max: 100 },
  'disk': { label: 'Disk (%)', unit: '%', min: 0, max: 100 },
  'uptime': { label: 'Uptime (days)', unit: 'days', min: 0, max: null },
  'node_offline': { label: 'Node offline', unit: '', min: 0, max: 1 },
  'vm_stopped': { label: 'VM stopped', unit: '', min: 0, max: 1 },
} as const

// Opérateurs supportés
export const OPERATORS = {
  'gt': { label: '>', description: 'greater than' },
  'gte': { label: '>=', description: 'greater than or equal to' },
  'lt': { label: '<', description: 'less than' },
  'lte': { label: '<=', description: 'less than or equal to' },
  'eq': { label: '=', description: 'equal to' },
  'neq': { label: '!=', description: 'not equal to' },
} as const

// Niveaux de sévérité
export const SEVERITIES = ['info', 'warning', 'critical'] as const

// Types de scope
export const SCOPE_TYPES = {
  'all': { label: 'All' },
  'connection': { label: 'Specific connection' },
  'node': { label: 'Specific node' },
  'vm': { label: 'Specific VM' },
} as const

// GET - Liste des règles
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_VIEW)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()

    const rules = await prisma.alertRule.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })

    // Transformer pour le frontend
    const formattedRules = rules.map(rule => ({
      id: rule.id,
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled,
      metric: rule.metric,
      metricLabel: METRIC_TYPES[rule.metric as keyof typeof METRIC_TYPES]?.label || rule.metric,
      operator: rule.operator,
      operatorLabel: OPERATORS[rule.operator as keyof typeof OPERATORS]?.label || rule.operator,
      threshold: rule.threshold,
      duration: rule.duration,
      severity: rule.severity,
      scopeType: rule.scopeType,
      scopeTarget: rule.scopeTarget,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    }))

    return NextResponse.json({
      data: formattedRules,
      meta: {
        metrics: METRIC_TYPES,
        operators: OPERATORS,
        severities: SEVERITIES,
        scopeTypes: SCOPE_TYPES,
      }
    })
  } catch (error: any) {
    console.error('GET alert-rules error:', error)

return NextResponse.json(
      { error: error?.message || 'Server error' },
      { status: 500 }
    )
  }
}

// POST - Créer une règle
async function handlePost(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (denied) return denied

    const body = await req.json()
    const { name, description, enabled, metric, operator, threshold, duration, severity, scopeType, scopeTarget } = body

    // Validation
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    if (!metric || !METRIC_TYPES[metric as keyof typeof METRIC_TYPES]) {
      return NextResponse.json({ error: 'Invalid metric' }, { status: 400 })
    }

    if (!operator || !OPERATORS[operator as keyof typeof OPERATORS]) {
      return NextResponse.json({ error: 'Invalid operator' }, { status: 400 })
    }

    if (threshold === undefined || threshold === null || Number.isNaN(Number(threshold))) {
      return NextResponse.json({ error: 'Invalid threshold' }, { status: 400 })
    }

    if (!severity || !SEVERITIES.includes(severity)) {
      return NextResponse.json({ error: 'Invalid severity' }, { status: 400 })
    }

    const tenantId = await getCurrentTenantId()
    const id = randomUUID()
    const now = new Date()

    await prisma.alertRule.create({
      data: {
        id,
        tenantId,
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
        createdAt: now,
        updatedAt: now,
      },
    })

    return NextResponse.json({
      data: { id },
      message: 'Rule created'
    }, { status: 201 })
  } catch (error: any) {
    console.error('POST alert-rules error:', error)

return NextResponse.json(
      { error: error?.message || 'Server error' },
      { status: 500 }
    )
  }
}

export const POST = withAudit({ category: 'alerts', resourceType: 'alert_rule' }, handlePost)
