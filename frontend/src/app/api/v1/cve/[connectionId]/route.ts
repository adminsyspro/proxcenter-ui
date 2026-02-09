import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'

// GET /api/v1/cve/{connectionId}?node=xxx — proxy to orchestrator
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const { searchParams } = new URL(request.url)
    const node = searchParams.get('node')

    let url = `${ORCHESTRATOR_URL}/api/v1/cve/${encodeURIComponent(connectionId)}`
    if (node) {
      url += `?node=${encodeURIComponent(node)}`
    }

    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || 'Failed to get CVE scan results' },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Error fetching CVEs:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/v1/cve/{connectionId} — force scan (proxy to orchestrator /scan)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const { searchParams } = new URL(request.url)
    const node = searchParams.get('node')

    let url = `${ORCHESTRATOR_URL}/api/v1/cve/${encodeURIComponent(connectionId)}/scan`
    if (node) {
      url += `?node=${encodeURIComponent(node)}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || 'Failed to scan for CVEs' },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Error scanning CVEs:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
