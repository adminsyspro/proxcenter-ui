import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db/sqlite'
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

// Configuration par défaut pour les métriques Green IT / RSE
const DEFAULT_GREEN_SETTINGS = {
  // === Paramètres Datacenter ===
  pue: 1.4, // Power Usage Effectiveness (1.0 = parfait, 2.0 = double consommation)
  
  // === Paramètres Électricité ===
  electricityPrice: 0.18, // Prix en €/kWh
  currency: 'EUR',
  
  // === Facteurs d'émission CO₂ (kg CO₂ / kWh) ===
  co2Country: 'france',
  co2Factor: 0.052, // Facteur personnalisé ou par pays
  co2Factors: {
    france: 0.052,      // Nucléaire majoritaire
    germany: 0.385,     // Mix charbon/renouvelable
    usa: 0.417,         // Mix varié
    uk: 0.233,          // Mix gaz/renouvelable
    spain: 0.210,       // Mix renouvelable/gaz
    italy: 0.330,       // Mix gaz/renouvelable
    poland: 0.650,      // Charbon majoritaire
    sweden: 0.045,      // Hydro/nucléaire
    norway: 0.020,      // Hydro majoritaire
    europe_avg: 0.276,  // Moyenne européenne
    world_avg: 0.475,   // Moyenne mondiale
    custom: 0.052,      // Valeur personnalisée
  },
  
  // === Spécifications Serveurs ===
  serverSpecs: {
    // Estimation automatique ou manuelle
    mode: 'auto', // 'auto' | 'manual'
    
    // Mode auto: paramètres moyens
    avgCoresPerServer: 64,
    avgRamPerServer: 256, // Go
    avgStoragePerServer: 4, // To
    
    // Consommation électrique
    tdpPerCore: 10, // Watts par cœur (TDP moyen)
    wattsPerGbRam: 0.375, // Watts par Go de RAM
    wattsPerTbStorage: 6, // Watts par To de stockage (HDD ~6W, SSD ~2W)
    storageType: 'mixed', // 'hdd' | 'ssd' | 'mixed'
    
    // Overhead par serveur (alimentation, ventilation locale, réseau)
    overheadPerServer: 50, // Watts
    
    // Mode manuel: liste des serveurs avec specs détaillées
    servers: [] as Array<{
      name: string
      cpuModel: string
      cpuTdp: number
      cores: number
      ramGb: number
      storageType: 'hdd' | 'ssd' | 'nvme'
      storageTb: number
      psuEfficiency: number // 0.8 = 80% efficacité PSU
    }>
  },
  
  // === Équivalences pédagogiques ===
  equivalences: {
    kmVoiture: 0.193,     // kg CO₂ par km (voiture moyenne essence)
    arbreParAn: 25,       // kg CO₂ absorbé par arbre/an
    chargeSmartphone: 0.0085, // kg CO₂ par charge complète
    trainKm: 0.003,       // kg CO₂ par km en train
    avionKm: 0.255,       // kg CO₂ par km en avion
  },
  
  // === Options d'affichage ===
  display: {
    showCost: true,
    showCo2: true,
    showEquivalences: true,
    showScore: true,
  }
}

export type GreenSettings = typeof DEFAULT_GREEN_SETTINGS

// GET /api/v1/settings/green - Récupérer les paramètres RSE/Green IT
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
    const row = stmt.get('green') as { value: string } | undefined
    
    if (row?.value) {
      // Fusionner avec les valeurs par défaut pour gérer les nouvelles propriétés
      const saved = JSON.parse(row.value)

      
return NextResponse.json({ 
        data: { ...DEFAULT_GREEN_SETTINGS, ...saved }
      })
    }
    
    // Valeurs par défaut
    return NextResponse.json({ data: DEFAULT_GREEN_SETTINGS })
  } catch (e: any) {
    console.error('Failed to get green settings:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT /api/v1/settings/green - Sauvegarder les paramètres RSE/Green IT
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
    
    // Fusionner avec les valeurs par défaut
    const settings = { ...DEFAULT_GREEN_SETTINGS, ...body }
    const value = JSON.stringify(settings)
    const now = new Date().toISOString()
    
    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at) 
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
    `)

    stmt.run('green', value, now, value, now)
    
    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Failed to save green settings:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
