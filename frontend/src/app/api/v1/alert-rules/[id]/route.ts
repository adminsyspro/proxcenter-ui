import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db/sqlite'
import { METRIC_TYPES, OPERATORS, SEVERITIES } from '../route'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

// GET - Détails d'une règle
export async function GET(req: Request, { params }: Params) {
  try {
    const { id } = await params
    const db = getDb()
    
    const rule = db.prepare(`SELECT * FROM alert_rules WHERE id = ?`).get(id) as any
    
    if (!rule) {
      return NextResponse.json({ error: 'Règle non trouvée' }, { status: 404 })
    }

    return NextResponse.json({ 
      data: {
        id: rule.id,
        name: rule.name,
        description: rule.description,
        enabled: rule.enabled === 1,
        metric: rule.metric,
        operator: rule.operator,
        threshold: rule.threshold,
        duration: rule.duration,
        severity: rule.severity,
        scopeType: rule.scope_type,
        scopeTarget: rule.scope_target,
        createdAt: rule.created_at,
        updatedAt: rule.updated_at,
      }
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
    const { id } = await params
    const body = await req.json()
    const { name, description, enabled, metric, operator, threshold, duration, severity, scopeType, scopeTarget } = body

    const db = getDb()
    
    // Vérifier que la règle existe
    const existing = db.prepare(`SELECT id FROM alert_rules WHERE id = ?`).get(id)

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

    if (threshold === undefined || threshold === null || isNaN(Number(threshold))) {
      return NextResponse.json({ error: 'Seuil invalide' }, { status: 400 })
    }

    if (!severity || !SEVERITIES.includes(severity)) {
      return NextResponse.json({ error: 'Sévérité invalide' }, { status: 400 })
    }

    const now = new Date().toISOString()

    db.prepare(`
      UPDATE alert_rules 
      SET name = ?, description = ?, enabled = ?, metric = ?, operator = ?, threshold = ?, duration = ?, severity = ?, scope_type = ?, scope_target = ?, updated_at = ?
      WHERE id = ?
    `).run(
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
      id
    )

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
    const { id } = await params
    const body = await req.json()
    const { enabled } = body

    const db = getDb()
    
    const existing = db.prepare(`SELECT id FROM alert_rules WHERE id = ?`).get(id)

    if (!existing) {
      return NextResponse.json({ error: 'Règle non trouvée' }, { status: 404 })
    }

    const now = new Date().toISOString()

    db.prepare(`
      UPDATE alert_rules SET enabled = ?, updated_at = ? WHERE id = ?
    `).run(enabled ? 1 : 0, now, id)

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
    const { id } = await params
    const db = getDb()
    
    const existing = db.prepare(`SELECT id FROM alert_rules WHERE id = ?`).get(id)

    if (!existing) {
      return NextResponse.json({ error: 'Règle non trouvée' }, { status: 404 })
    }

    // Supprimer aussi les alertes déclenchées par cette règle
    db.prepare(`DELETE FROM alert_instances WHERE rule_id = ?`).run(id)
    db.prepare(`DELETE FROM alert_rules WHERE id = ?`).run(id)

    return NextResponse.json({ message: 'Règle supprimée' })
  } catch (error: any) {
    console.error('Erreur DELETE alert-rules/[id]:', error)
    
return NextResponse.json(
      { error: error?.message || 'Erreur serveur' },
      { status: 500 }
    )
  }
}
