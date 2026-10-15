import { NextResponse } from 'next/server'

import { PveLicenseExcludedError } from '@/lib/license/exclusions'

export function apiError(message: string, status: number = 500, error?: unknown) {
  if (error) console.error(`API Error [${status}]:`, message, error)
  return NextResponse.json({ error: message }, { status })
}

export function apiSuccess(data: any, status: number = 200) {
  return NextResponse.json(data, { status })
}

/**
 * The answer to a write pveFetch refused because the connection is outside
 * the license (roadmap#58): 403 with a code the UI recognises. Null for any
 * other error, so a route keeps its own conversion for those.
 */
export function licenseExcludedResponse(error: unknown): NextResponse | null {
  if (!(error instanceof PveLicenseExcludedError)) return null
  return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
}
