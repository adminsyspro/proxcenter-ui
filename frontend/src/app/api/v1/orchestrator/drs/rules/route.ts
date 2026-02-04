// src/app/api/v1/orchestrator/drs/rules/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

export const runtime = "nodejs"

// GET /api/v1/orchestrator/drs/rules
export async function GET() {
  try {
    const client = getOrchestratorClient()
    
    if (!client) {
      // Retourner un tableau vide si l'orchestrator n'est pas configuré
      return NextResponse.json([])
    }

    const response = await client.getRules()

    
return NextResponse.json(response.data || [])
  } catch (error: any) {
    console.error('Failed to fetch affinity rules:', error)

    // Retourner un tableau vide en cas d'erreur
    return NextResponse.json([])
  }
}

// POST /api/v1/orchestrator/drs/rules - Créer une nouvelle règle
export async function POST(request: NextRequest) {
  try {
    const client = getOrchestratorClient()
    
    if (!client) {
      return NextResponse.json(
        { error: 'Orchestrator not configured' },
        { status: 503 }
      )
    }

    const body = await request.json()
    const response = await client.createRule(body)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Failed to create affinity rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to create rule' },
      { status: 500 }
    )
  }
}
