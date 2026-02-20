// src/app/api/v1/orchestrator/drs/settings/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

export const runtime = "nodejs"

// Default settings that match the frontend DRSSettings interface
const defaultSettings = {
  enabled: true,
  mode: 'manual',
  balancing_method: 'memory',
  balancing_mode: 'used',
  balance_types: ['vm', 'ct'],
  maintenance_nodes: [],
  ignore_nodes: [],
  cpu_high_threshold: 80,
  cpu_low_threshold: 20,
  memory_high_threshold: 85,
  memory_low_threshold: 25,
  storage_high_threshold: 90,
  imbalance_threshold: 5,
  homogenization_enabled: true,
  max_load_spread: 10,
  cpu_weight: 1.0,
  memory_weight: 1.0,
  storage_weight: 0.5,
  max_concurrent_migrations: 2,
  migration_cooldown: '5m',
  balance_larger_first: false,
  prevent_overprovisioning: true,
  enable_affinity_rules: true,
  enforce_affinity: false,
  rebalance_schedule: 'interval',
  rebalance_interval: '15m',
  rebalance_time: '10:00',
}

// GET /api/v1/orchestrator/drs/settings
export async function GET() {
  try {
    const client = getOrchestratorClient()
    
    if (!client) {
      // Retourner des settings par défaut si l'orchestrator n'est pas configuré
      return NextResponse.json(defaultSettings)
    }

    const response = await client.get('/drs/settings')
    
    // Merge with defaults to ensure all fields exist
    // This handles the case where the backend doesn't return all fields
    const mergedSettings = {
      ...defaultSettings,
      ...response.data,

      // Ensure arrays are never undefined/null
      balance_types: response.data?.balance_types ?? defaultSettings.balance_types,
      maintenance_nodes: response.data?.maintenance_nodes ?? defaultSettings.maintenance_nodes,
      ignore_nodes: response.data?.ignore_nodes ?? defaultSettings.ignore_nodes,
    }
    
    return NextResponse.json(mergedSettings)
  } catch (error: any) {
    console.error('Failed to fetch DRS settings:', error)

    // Retourner des settings par défaut en cas d'erreur
    return NextResponse.json(defaultSettings)
  }
}

// PUT /api/v1/orchestrator/drs/settings
export async function PUT(request: NextRequest) {
  try {
    const client = getOrchestratorClient()
    
    if (!client) {
      return NextResponse.json(
        { error: 'Orchestrator not configured' },
        { status: 503 }
      )
    }

    const body = await request.json()
    const response = await client.put('/drs/settings', body)
    
    // Merge response with defaults to ensure all fields exist
    const mergedSettings = {
      ...defaultSettings,
      ...response.data,
      balance_types: response.data?.balance_types ?? defaultSettings.balance_types,
      maintenance_nodes: response.data?.maintenance_nodes ?? defaultSettings.maintenance_nodes,
      ignore_nodes: response.data?.ignore_nodes ?? defaultSettings.ignore_nodes,
    }
    
    return NextResponse.json(mergedSettings)
  } catch (error: any) {
    console.error('Failed to update DRS settings:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to update settings' },
      { status: 500 }
    )
  }
}
