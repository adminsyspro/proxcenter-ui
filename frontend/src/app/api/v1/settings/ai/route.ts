import { NextResponse } from 'next/server'
import dns from 'node:dns/promises'

import { getDb } from '@/lib/db/sqlite'
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

/**
 * Check if an IP address belongs to a private/reserved range.
 * Blocks RFC1918, loopback, link-local, and other non-routable addresses.
 */
function isPrivateIP(ip: string): boolean {
  // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  const mapped = ip.replace(/^::ffff:/, '')
  const parts = mapped.split('.').map(Number)

  if (parts.length === 4 && parts.every(p => !isNaN(p))) {
    // 10.0.0.0/8
    if (parts[0] === 10) return true
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true
    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true
    // 0.0.0.0/8
    if (parts[0] === 0) return true
  }

  // IPv6 loopback
  if (ip === '::1' || ip === '::') return true

  // IPv6 link-local
  if (ip.startsWith('fe80:')) return true

  // IPv6 unique local (fc00::/7)
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true

  return false
}

/**
 * Resolve a hostname and check whether it points to a private IP.
 * Returns an error message string if blocked, or null if OK.
 */
async function checkUrlForSSRF(rawUrl: string): Promise<string | null> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return "Invalid URL"
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return "Invalid protocol for Ollama URL"
  }

  const hostname = url.hostname

  // If hostname is already an IP literal, check directly
  if (isPrivateIP(hostname)) {
    return "Ollama URL must not point to a private/reserved IP address"
  }

  // Resolve the hostname and check all resulting IPs
  try {
    const { address } = await dns.lookup(hostname)
    if (isPrivateIP(address)) {
      return "Ollama URL hostname resolves to a private/reserved IP address"
    }
  } catch {
    // DNS resolution failure - allow it through (the fetch will fail naturally)
  }

  return null
}

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

    // Validate Ollama URL to prevent SSRF (protocol + private IP check)
    if (body.ollamaUrl) {
      const ssrfError = await checkUrlForSSRF(body.ollamaUrl)
      if (ssrfError) {
        return NextResponse.json({ error: ssrfError }, { status: 400 })
      }
    }

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
