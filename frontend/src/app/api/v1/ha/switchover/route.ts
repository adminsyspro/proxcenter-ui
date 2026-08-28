import { haOperationWithBody } from '@/lib/orchestrator/haRoute'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = haOperationWithBody('/ha/switchover', 'POST')
