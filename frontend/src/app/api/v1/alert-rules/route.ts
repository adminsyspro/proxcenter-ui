import { randomUUID } from 'crypto'

import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db/sqlite'

export const runtime = 'nodejs'

// Types de métriques supportées
export const METRIC_TYPES = {
  'cpu': { label: 'CPU (%)', unit: '%', min: 0, max: 100 },
  'memory': { label: 'RAM (%)', unit: '%', min: 0, max: 100 },
  'disk': { label: 'Disque (%)', unit: '%', min: 0, max: 100 },
  'uptime': { label: 'Uptime (jours)', unit: 'jours', min: 0, max: null },
  'node_offline': { label: 'Node hors ligne', unit: '', min: 0, max: 1 },
  'vm_stopped': { label: 'VM arrêtée', unit: '', min: 0, max: 1 },
} as const

// Opérateurs supportés
export const OPERATORS = {
  'gt': { label: '>', description: 'supérieur à' },
  'gte': { label: '>=', description: 'supérieur ou égal à' },
  'lt': { label: '<', description: 'inférieur à' },
  'lte': { label: '<=', description: 'inférieur ou égal à' },
  'eq': { label: '=', description: 'égal à' },
  'neq': { label: '!=', description: 'différent de' },
} as const

// Niveaux de sévérité
export const SEVERITIES = ['info', 'warning', 'critical'] as const

// Types de scope
export const SCOPE_TYPES = {
  'all': { label: 'Tout' },
  'connection': { label: 'Connexion spécifique' },
  'node': { label: 'Node spécifique' },
  'vm': { label: 'VM spécifique' },
} as const

type AlertRule = {
  id: string
  name: string
  description: string | null
  enabled: number
  metric: string
  operator: string
  threshold: number
  duration: number
  severity: string
  scope_type: string
  scope_target: string | null
  created_at: string
  updated_at: string
}

// GET - Liste des règles
export async function GET() {
  try {
    const db = getDb()

    const rules = db.prepare(`
      SELECT * FROM alert_rules ORDER BY created_at DESC
    `).all() as AlertRule[]

    // Transformer pour le frontend
    const formattedRules = rules.map(rule => ({
      id: rule.id,
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled === 1,
      metric: rule.metric,
      metricLabel: METRIC_TYPES[rule.metric as keyof typeof METRIC_TYPES]?.label || rule.metric,
      operator: rule.operator,
      operatorLabel: OPERATORS[rule.operator as keyof typeof OPERATORS]?.label || rule.operator,
      threshold: rule.threshold,
      duration: rule.duration,
      severity: rule.severity,
      scopeType: rule.scope_type,
      scopeTarget: rule.scope_target,
      createdAt: rule.created_at,
      updatedAt: rule.updated_at,
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
    console.error('Erreur GET alert-rules:', error)
    
return NextResponse.json(
      { error: error?.message || 'Erreur serveur' },
      { status: 500 }
    )
  }
}

// POST - Créer une règle
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name, description, enabled, metric, operator, threshold, duration, severity, scopeType, scopeTarget } = body

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

    if (threshold === undefined || threshold === null || isNaN(Number(threshold))) {
      return NextResponse.json({ error: 'Seuil invalide' }, { status: 400 })
    }

    if (!severity || !SEVERITIES.includes(severity)) {
      return NextResponse.json({ error: 'Sévérité invalide' }, { status: 400 })
    }

    const db = getDb()
    const id = randomUUID()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO alert_rules (id, name, description, enabled, metric, operator, threshold, duration, severity, scope_type, scope_target, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name.trim(),
      description?.trim() || null,
      enabled !== false ? 1 : 0,
      metric,
      operator,
      Number(threshold),
      Number(duration) || 0,
      severity,
      scopeType || 'all',
      scopeTarget?.trim() || null,
      now,
      now
    )

    return NextResponse.json({ 
      data: { id },
      message: 'Règle créée avec succès'
    }, { status: 201 })
  } catch (error: any) {
    console.error('Erreur POST alert-rules:', error)
    
return NextResponse.json(
      { error: error?.message || 'Erreur serveur' },
      { status: 500 }
    )
  }
}
