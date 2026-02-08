import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db/sqlite'
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

// GET /api/v1/settings/ai - Récupérer les paramètres IA
export async function GET() {
  try {
    // RBAC: Check admin.settings permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const db = getDb()
    
    // Créer la table settings si elle n'existe pas
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?')
    const row = stmt.get('ai') as { value: string } | undefined
    
    if (row?.value) {
      return NextResponse.json({ data: JSON.parse(row.value) })
    }
    
    // Valeurs par défaut
    return NextResponse.json({ 
      data: {
        enabled: false,
        provider: 'ollama',
        ollamaUrl: 'http://localhost:11434',
        ollamaModel: 'mistral:7b',
        openaiKey: '',
        openaiModel: 'gpt-4o-mini',
        anthropicKey: '',
        anthropicModel: 'claude-3-haiku-20240307'
      }
    })
  } catch (e: any) {
    console.error('Failed to get AI settings:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT /api/v1/settings/ai - Sauvegarder les paramètres IA
export async function PUT(request: Request) {
  try {
    // RBAC: Check admin.settings permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const body = await request.json()
    const db = getDb()
    
    // Créer la table settings si elle n'existe pas
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    const value = JSON.stringify(body)
    const now = new Date().toISOString()
    
    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at) 
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
    `)

    stmt.run('ai', value, now, value, now)
    
    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Failed to save AI settings:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
