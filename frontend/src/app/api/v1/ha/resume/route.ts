import { haOperation } from '@/lib/orchestrator/haRoute'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = haOperation('/ha/resume', 'POST')
