// src/app/api/v1/orchestrator/drs/settings/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { getSetting, setSetting } from '@/lib/db/settings'
import { getCurrentTenantId } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { defaultDRSSettings } from '@/components/automation/drs/drsSettings'

export const runtime = "nodejs"

// Frontend-only settings not supported by orchestrator — stored in local settings table
// IMPORTANT: max_concurrent_migrations and migration_cooldown are NOT frontend-only
// — they MUST be sent to the orchestrator for safety enforcement
const FRONTEND_ONLY_KEYS = ['max_pending_recommendations'] as const

async function getFrontendSettings(): Promise<Record<string, any>> {
  try {
    const all = (await getSetting<Record<string, any>>('drs_frontend_settings')) ?? {}
    // Only return keys that are actually frontend-only (filter out keys now managed by orchestrator)
    const filtered: Record<string, any> = {}
    for (const key of FRONTEND_ONLY_KEYS) {
      if (all[key] !== undefined) filtered[key] = all[key]
    }
    return filtered
  } catch { return {} }
}

async function saveFrontendSettings(data: Record<string, any>): Promise<void> {
  try {
    await setSetting('drs_frontend_settings', 'default', data)
  } catch (e) { console.error('[drs/settings] Failed to save frontend settings:', e) }
}

// Default settings come from the shared module so the client panel and the
// API route can't drift. The legacy alias `defaultSettings` is kept inline
// for the rest of this file's existing references.
const defaultSettings = defaultDRSSettings

// GET /api/v1/orchestrator/drs/settings
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW)
    if (denied) return denied

    const client = getOrchestratorClient()
    
    if (!client) {
      // Retourner des settings par défaut si l'orchestrator n'est pas configuré
      return NextResponse.json(defaultSettings)
    }

    const response = await client.get('/drs/settings')

    // Merge with defaults to ensure all fields exist
    const mergedSettings = {
      ...defaultSettings,
      ...response.data,
      balance_types: response.data?.balance_types ?? defaultSettings.balance_types,
      maintenance_nodes: response.data?.maintenance_nodes ?? defaultSettings.maintenance_nodes,
      excluded_clusters: response.data?.excluded_clusters ?? defaultSettings.excluded_clusters,
      excluded_nodes: response.data?.excluded_nodes ?? defaultSettings.excluded_nodes,
      cluster_modes: response.data?.cluster_modes ?? defaultSettings.cluster_modes,
      // Merge frontend-only settings from local DB
      ...(await getFrontendSettings()),
    }

    return NextResponse.json(mergedSettings)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to fetch DRS settings:', error)
    }

    // Retourner des settings par défaut en cas d'erreur
    return NextResponse.json(defaultSettings)
  }
}

// PUT /api/v1/orchestrator/drs/settings
export async function PUT(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE)
    if (denied) return denied

    const client = getOrchestratorClient()
    
    if (!client) {
      return NextResponse.json(
        { error: 'Orchestrator not configured' },
        { status: 503 }
      )
    }

    const body = await request.json()

    // Extract and save frontend-only settings locally
    const frontendData: Record<string, any> = {}
    for (const key of FRONTEND_ONLY_KEYS) {
      if (body[key] !== undefined) {
        frontendData[key] = body[key]
      }
    }
    if (Object.keys(frontendData).length > 0) {
      await saveFrontendSettings({ ...(await getFrontendSettings()), ...frontendData })
    }

    const response = await client.put('/drs/settings', body)

    // Merge response with defaults + frontend-only settings
    const mergedSettings = {
      ...defaultSettings,
      ...response.data,
      balance_types: response.data?.balance_types ?? defaultSettings.balance_types,
      maintenance_nodes: response.data?.maintenance_nodes ?? defaultSettings.maintenance_nodes,
      excluded_clusters: response.data?.excluded_clusters ?? defaultSettings.excluded_clusters,
      excluded_nodes: response.data?.excluded_nodes ?? defaultSettings.excluded_nodes,
      cluster_modes: response.data?.cluster_modes ?? defaultSettings.cluster_modes,
      ...(await getFrontendSettings()),
    }

    return NextResponse.json(mergedSettings)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to update DRS settings:', error)
    }
    
return NextResponse.json(
      { error: error.message || 'Failed to update settings' },
      { status: 500 }
    )
  }
}
