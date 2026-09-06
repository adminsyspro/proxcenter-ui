import { NextResponse } from 'next/server'

import { parseOrchestratorError } from './client'

export function replicationErrorResponse(error: unknown, fallback: string) {
  const upstream = parseOrchestratorError(error)

  return NextResponse.json(
    { error: upstream?.message || (error instanceof Error ? error.message : fallback) },
    { status: upstream?.status || 500 },
  )
}
