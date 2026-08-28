import { haOperationWithBody } from '@/lib/orchestrator/haRoute'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = haOperationWithBody('/ha/sync-mode', 'PUT')
